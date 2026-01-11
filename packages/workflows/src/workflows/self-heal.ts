/**
 * AI Swarm v2 - Self-Healing Workflow
 *
 * Continuous monitoring workflow that:
 * - Checks worker health
 * - Monitors stuck workflows
 * - Runs daily garbage collection
 * - Sends alerts on issues
 */

import {
    proxyActivities,
    defineSignal,
    setHandler,
    sleep,
    continueAsNew,
    log,  // Import log from workflow
} from '@temporalio/workflow';

import type { SupervisorOutput } from '@ai-swarm/shared';
import type * as activities from '../activities/index.js';

// =============================================================================
// ACTIVITY PROXIES
// =============================================================================

const { performHealthCheck, sendNotification, runCleanup, pruneWorktrees } = proxyActivities<typeof activities>({
    startToCloseTimeout: '5 minutes',
    retry: {
        maximumAttempts: 2,
        initialInterval: '10s',
    },
});

// =============================================================================
// SIGNALS
// =============================================================================

export const stopMonitoringSignal = defineSignal('stopMonitoring');

// =============================================================================
// CONSTANTS
// =============================================================================

// Run cleanup once every 24 hours
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// =============================================================================
// WORKFLOW
// =============================================================================

export interface SelfHealInput {
    checkIntervalSeconds: number;
    maxIterationsBeforeReset: number;
    iterationCount?: number;
    lastCleanupTime?: number;
}

/**
 * Self-Healing Workflow
 *
 * Runs continuously, performing health checks and self-healing actions.
 * Uses continueAsNew to avoid history growth.
 */
export async function selfHeal(input: SelfHealInput): Promise<void> {
    const {
        checkIntervalSeconds = 60,
        maxIterationsBeforeReset = 100,
        iterationCount = 0,
        lastCleanupTime = 0,
    } = input;

    let shouldStop = false;

    setHandler(stopMonitoringSignal, () => {
        shouldStop = true;
    });

    // ===========================================================================
    // HEALTH CHECK
    // ===========================================================================
    const result: SupervisorOutput = await performHealthCheck();

    // Handle degraded or critical status
    if (result.healthStatus === 'critical' && result.escalated) {
        await sendNotification({
            subject: '[AI Swarm] CRITICAL: System Health Alert',
            body: `
Critical system health issue detected!

**Status:** ${result.healthStatus}
**Actions Taken:** ${result.actionsTaken.join(', ') || 'None'}
**Escalated:** Yes

Manual intervention may be required.
      `.trim(),
            priority: 'high',
        });
    } else if (result.healthStatus === 'degraded') {
        await sendNotification({
            subject: '[AI Swarm] Warning: System Degraded',
            body: `
System health is degraded.

**Status:** ${result.healthStatus}
**Actions Taken:** ${result.actionsTaken.join(', ') || 'None'}
      `.trim(),
            priority: 'normal',
        });
    }

    // ===========================================================================
    // DAILY CLEANUP
    // ===========================================================================
    const now = Date.now();
    let newLastCleanupTime = lastCleanupTime;

    // FIX: Switched from iteration count to timestamp to ensure cleanup runs
    // even after continueAsNew resets the iteration counter.
    if (now - lastCleanupTime >= CLEANUP_INTERVAL_MS) {
        try {
            const cleanupResult = await runCleanup();

            if (cleanupResult.deletedTasks > 0 || cleanupResult.deletedChats > 0) {
                // Log cleanup results
                log.info('Cleanup completed', {
                    deletedTasks: cleanupResult.deletedTasks,
                    deletedChats: cleanupResult.deletedChats
                });
            }

            // NEW: Prune git worktrees
            const pruneResult = await pruneWorktrees();
            if (pruneResult.pruned > 0) {
                log.info('Worktrees pruned', { pruned: pruneResult.pruned });
            }

            newLastCleanupTime = now;
        } catch (error) {
            log.error('Cleanup failed', { error });
        }
    }

    // Check if we should stop
    if (shouldStop) {
        return;
    }

    // Wait for next check
    await sleep(`${checkIntervalSeconds}s`);

    // Continue as new to prevent history growth
    const newIterationCount = iterationCount + 1;
    if (newIterationCount >= maxIterationsBeforeReset) {
        await continueAsNew<typeof selfHeal>({
            checkIntervalSeconds,
            maxIterationsBeforeReset,
            iterationCount: 0,
            lastCleanupTime: newLastCleanupTime, // Preserve cleanup time across resets
        });
    } else {
        await continueAsNew<typeof selfHeal>({
            checkIntervalSeconds,
            maxIterationsBeforeReset,
            iterationCount: newIterationCount,
            lastCleanupTime: newLastCleanupTime,
        });
    }
}
