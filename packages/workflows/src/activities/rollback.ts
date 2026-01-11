/**
 * AI Swarm v2 - Rollback Activity
 *
 * Reverts git commits when deployments fail.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import {
    logger,
    logActivityStart,
    logActivityComplete,
    Task,
} from '@ai-swarm/shared';
import { Redis } from 'ioredis';
import { Client, Connection } from '@temporalio/client';
import { developFeature } from '../workflows/develop-feature.js';

const execAsync = promisify(exec);

// =============================================================================
// TYPES
// =============================================================================

export interface RollbackInput {
    commitSha: string;
    reason: string;
}

export interface RollbackOutput {
    success: boolean;
    revertCommitSha?: string;
    error?: string;
}

// =============================================================================
// ROLLBACK ACTIVITY
// =============================================================================

/**
 * Revert a commit and push the revert.
 */
export async function rollbackCommit(input: RollbackInput): Promise<RollbackOutput> {
    const startTime = Date.now();
    logActivityStart('rollback', 'rollbackCommit', { commitSha: input.commitSha });

    const projectDir = process.env.PROJECT_DIR || process.cwd();

    try {
        // FIX: Replaced hardcoded 'main' with dynamic branch detection to support feature branches
        const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectDir });
        const branch = currentBranch.trim();

        logger.info({ branch }, 'Fetching latest changes');
        await execAsync('git fetch origin', { cwd: projectDir });
        await execAsync(`git checkout ${branch}`, { cwd: projectDir });
        await execAsync(`git pull origin ${branch}`, { cwd: projectDir });

        // =======================================================================
        // STEP 2: Revert the commit
        // =======================================================================
        logger.info({ commitSha: input.commitSha, branch }, 'Reverting commit');

        const revertResult = await execAsync(
            `git revert --no-edit ${input.commitSha}`,
            { cwd: projectDir }
        );

        // Get the revert commit SHA
        const { stdout: revertSha } = await execAsync(
            'git rev-parse HEAD',
            { cwd: projectDir }
        );

        // =======================================================================
        // STEP 3: Push the revert
        // ==================
        logger.info({ branch }, 'Pushing revert');
        await execAsync(`git push origin ${branch}`, { cwd: projectDir });

        const durationMs = Date.now() - startTime;
        logActivityComplete('rollback', 'rollbackCommit', durationMs, true);

        return {
            success: true,
            revertCommitSha: revertSha.trim(),
        };
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('rollback', 'rollbackCommit', durationMs, false);

        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage, commitSha: input.commitSha }, 'Rollback failed');

        // Try to abort any in-progress revert
        try {
            await execAsync('git revert --abort', { cwd: projectDir });
        } catch {
            // Ignore - revert may not be in progress
        }

        return {
            success: false,
            error: errorMessage,
        };
    }
}

/**
 * Create a fix task for a failed deployment.
 * This actually starts a new Temporal workflow to fix the issue.
 */
export async function createFixTask(input: {
    originalTaskId: string;
    originalTaskTitle: string;
    error: string;
    commitSha?: string;
}): Promise<{
    fixTaskId: string;
    chainDepth: number;
}> {
    const startTime = Date.now();
    logActivityStart('rollback', 'createFixTask', { originalTaskId: input.originalTaskId });

    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

    try {
        // Get current chain depth
        const chainKey = `task:chain:${input.originalTaskId}`;
        const currentDepth = await redis.incr(chainKey);

        // Set expiry on chain tracking (7 days)
        await redis.expire(chainKey, 7 * 24 * 60 * 60);

        // Generate fix task ID
        const fixTaskId = `fix-${input.originalTaskId}-${currentDepth}`;

        logger.info({
            originalTaskId: input.originalTaskId,
            fixTaskId,
            chainDepth: currentDepth,
        }, 'Creating fix task');

        // =======================================================================
        // CREATE AND START FIX TASK WORKFLOW
        // =======================================================================

        // Create a fix task description
        const fixTask: Task = {
            id: fixTaskId,
            title: `[FIX] ${input.originalTaskTitle}`,
            context: `
Original task failed. Please fix the issue.

**Original Task:** ${input.originalTaskTitle}
**Original Task ID:** ${input.originalTaskId}
**Commit SHA:** ${input.commitSha || 'N/A'}

**Error that occurred:**
${input.error}

**Action Required:**
1. Investigate the error and understand what went wrong
2. Create a plan to fix the issue
3. Implement the fix
4. Verify the fix works correctly

This is fix attempt #${currentDepth}. Please be thorough in your analysis.
            `.trim(),
            acceptanceCriteria: [
                'The original error is resolved',
                'Build and tests pass successfully',
                'No new issues are introduced',
            ],
            filesToModify: [], // Will be determined by the Planner
            priority: 'high',
            createdAt: new Date(),
        };

        // Connect to Temporal and start the fix workflow
        const connection = await Connection.connect({
            address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
        });

        const client = new Client({
            connection,
            namespace: process.env.TEMPORAL_NAMESPACE || 'ai-swarm',
        });

        // Start the fix task workflow
        const workflowId = `fix-workflow-${input.originalTaskId}-${currentDepth}`;

        await client.workflow.execute(developFeature, {
            taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'ai-swarm-tasks',
            workflowId,
            args: [{
                task: fixTask,
                skipApproval: true, // Auto-approve fix tasks for faster resolution
                notifyOnComplete: true,
                isFixTask: true,
                originalTaskId: input.originalTaskId,
            }],
        });

        logger.info({
            fixTaskId,
            workflowId,
            originalTaskId: input.originalTaskId,
            chainDepth: currentDepth,
        }, 'Fix task workflow started');

        await connection.close();

        const durationMs = Date.now() - startTime;
        logActivityComplete('rollback', 'createFixTask', durationMs, true);

        return {
            fixTaskId,
            chainDepth: currentDepth,
        };
    } finally {
        await redis.quit();
    }
}

/**
 * Check if a task is in a fix-task loop.
 */
export async function checkFixTaskLoop(originalTaskId: string): Promise<{
    isLoop: boolean;
    chainDepth: number;
}> {
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

    try {
        const chainKey = `task:chain:${originalTaskId}`;
        const depth = await redis.get(chainKey);
        const chainDepth = depth ? parseInt(depth, 10) : 0;

        // Consider it a loop if we've had more than 2 fix attempts
        const isLoop = chainDepth >= 2;

        if (isLoop) {
            logger.warn({ originalTaskId, chainDepth }, 'Fix-task loop detected');
        }

        return { isLoop, chainDepth };
    } finally {
        await redis.quit();
    }
}
