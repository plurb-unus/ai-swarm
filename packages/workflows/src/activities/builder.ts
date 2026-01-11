/**
 * AI Swarm v3.0.0 - Builder Activity
 *
 * Manages builds in the persistent Builder service container.
 * Tools installed by AI persist via the tools volume.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger, logActivityStart, logActivityComplete } from '@ai-swarm/shared';

const execAsync = promisify(exec);

export type ProjectType = 'nodejs' | 'go' | 'python' | 'rust' | 'unknown';

export interface BuilderOptions {
    taskId: string;
    workDir: string;
    projectType: ProjectType;
    command: string;
    timeoutMs?: number;
}

export interface BuilderResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
}

const BUILDER_CONTAINER = 'ai-swarm-builder';
const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes

/**
 * Run a command in the persistent Builder service.
 * Uses docker exec to run commands in the already-running container.
 * Tools installed by AI persist across tasks via the tools volume.
 */
export async function runInBuilder(options: BuilderOptions): Promise<BuilderResult> {
    const startTime = Date.now();
    const timeout = options.timeoutMs || DEFAULT_TIMEOUT_MS;

    logActivityStart('deployer', 'runInBuilder', {
        taskId: options.taskId,
        projectType: options.projectType,
        workDir: options.workDir,
    });

    try {
        // Run command as worker user
        const escapedCommand = options.command.replace(/"/g, '\\"');
        const cmd = `docker exec --user worker ${BUILDER_CONTAINER} /bin/bash -c "cd ${options.workDir} && ${escapedCommand}"`;

        logger.info({ cmd, workDir: options.workDir }, 'Executing in Builder');

        const { stdout, stderr } = await execAsync(cmd, { timeout });

        const durationMs = Date.now() - startTime;
        logActivityComplete('deployer', 'runInBuilder', durationMs, true);

        return {
            success: true,
            stdout,
            stderr,
            exitCode: 0,
        };
    } catch (error: any) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('deployer', 'runInBuilder', durationMs, false);

        logger.error({ error: error.message, taskId: options.taskId }, 'Builder command failed');

        return {
            success: false,
            stdout: error.stdout || '',
            stderr: error.stderr || error.message,
            exitCode: error.code || 1,
        };
    } finally {
        // Fix permissions - ensure worker user owns all created files
        try {
            await execAsync(
                `docker exec --user root ${BUILDER_CONTAINER} chown -R worker:worker ${options.workDir}`,
                { timeout: 30000 }
            );
        } catch (chownError) {
            logger.warn({ workDir: options.workDir }, 'Failed to fix permissions after build');
        }
    }
}

/**
 * Install a tool in the Builder container.
 * Tool persists in the tools volume across container recreations.
 */
export async function installToolInBuilder(tool: string, installCmd: string): Promise<boolean> {
    logger.info({ tool, installCmd }, 'Installing tool in Builder');

    try {
        // Use sudo for package installs
        const cmd = `docker exec --user worker ${BUILDER_CONTAINER} /bin/bash -c "sudo ${installCmd}"`;
        await execAsync(cmd, { timeout: 120000 });
        logger.info({ tool }, 'Tool installed successfully');
        return true;
    } catch (error: any) {
        logger.error({ tool, error: error.message }, 'Failed to install tool');
        return false;
    }
}

/**
 * Check if the Builder container is running and healthy.
 */
export async function isBuilderHealthy(): Promise<boolean> {
    try {
        const { stdout } = await execAsync(
            `docker inspect --format='{{.State.Running}}' ${BUILDER_CONTAINER}`,
            { timeout: 5000 }
        );
        return stdout.trim() === 'true';
    } catch {
        return false;
    }
}
