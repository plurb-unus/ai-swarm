/**
 * AI Swarm v2 - Supervisor Activity
 *
 * Health checks, kill switch monitoring, and self-healing actions.
 */

import {
    SupervisorOutput,
    HealthCheckResult,
    logger,
    logActivityStart,
    logActivityComplete,
    cleanupOldChats,
} from '@ai-swarm/shared';
import { Client, Connection } from '@temporalio/client';
import { Redis } from 'ioredis';

/**
 * Check if the swarm is paused (kill switch).
 */
export async function checkKillSwitch(): Promise<boolean> {
    if (!process.env.REDIS_URL) {
        return false;
    }

    try {
        const redis = new Redis(process.env.REDIS_URL);

        const paused = await redis.get('swarm:paused');
        await redis.quit();

        return paused === 'true';
    } catch (error) {
        logger.warn({ error }, 'Failed to check kill switch');
        return false;
    }
}

/**
 * Perform health checks on the system.
 */
export async function performHealthCheck(): Promise<SupervisorOutput> {
    const startTime = Date.now();
    logActivityStart('supervisor', 'performHealthCheck', {});

    const actionsTaken: string[] = [];
    const healthResults: HealthCheckResult[] = [];

    try {
        // =======================================================================
        // CHECK 0: Kill Switch
        // =======================================================================
        const isPaused = await checkKillSwitch();
        if (isPaused) {
            const durationMs = Date.now() - startTime;
            logActivityComplete('supervisor', 'performHealthCheck', durationMs, true);

            return {
                healthStatus: 'healthy',  // Paused is not unhealthy
                actionsTaken: ['Swarm is paused - skipping health checks'],
                escalated: false,
            };
        }

        // =======================================================================
        // CHECK 1: Temporal Connection
        // =======================================================================
        try {
            const connection = await Connection.connect({
                address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
            });
            const client = new Client({ connection });

            // List workflows to verify connection
            const workflows = client.workflow.list({
                query: 'ExecutionStatus="Running"',
            });

            let runningCount = 0;
            let stuckCount = 0;
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

            for await (const wf of workflows) {
                runningCount++;

                // Check for stuck workflows (running > 1 hour)
                if (wf.startTime && new Date(wf.startTime) < oneHourAgo) {
                    stuckCount++;
                }

                if (runningCount >= 50) break;
            }

            healthResults.push({
                service: 'temporal',
                status: 'healthy',
                latencyMs: Date.now() - startTime,
                message: `${runningCount} running workflows, ${stuckCount} stuck`,
            });

            actionsTaken.push(`Checked Temporal: ${runningCount} running, ${stuckCount} stuck`);

            if (stuckCount > 0) {
                actionsTaken.push(`Warning: ${stuckCount} workflows running > 1 hour`);
            }

            await connection.close();
        } catch (error) {
            healthResults.push({
                service: 'temporal',
                status: 'unhealthy',
                latencyMs: Date.now() - startTime,
                message: error instanceof Error ? error.message : String(error),
            });
        }

        // =======================================================================
        // CHECK 2: Redis Connection
        // =======================================================================
        if (process.env.REDIS_URL) {
            try {
                const redis = new Redis(process.env.REDIS_URL);

                const pingStart = Date.now();
                await redis.ping();
                const pingLatency = Date.now() - pingStart;

                // FIX: Use SCAN instead of KEYS to avoid blocking Redis
                const loopKeys: string[] = [];
                let cursor = '0';
                do {
                    const result = await redis.scan(cursor, 'MATCH', 'task:chain:*', 'COUNT', '100');
                    cursor = result[0];
                    loopKeys.push(...result[1]);
                } while (cursor !== '0');

                let loopCount = 0;
                for (const key of loopKeys) {
                    const depth = await redis.get(key);
                    if (depth && parseInt(depth, 10) >= 2) {
                        loopCount++;
                    }
                }

                healthResults.push({
                    service: 'redis',
                    status: 'healthy',
                    latencyMs: pingLatency,
                    message: loopCount > 0 ? `${loopCount} potential loops` : undefined,
                });

                actionsTaken.push(`Checked Redis: ${pingLatency}ms latency`);

                if (loopCount > 0) {
                    actionsTaken.push(`Warning: ${loopCount} fix-task loops detected`);
                }

                await redis.quit();
            } catch (error) {
                healthResults.push({
                    service: 'redis',
                    status: 'unhealthy',
                    latencyMs: 0,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // =======================================================================
        // CHECK 3: Gemini CLI Health (optional)
        // =======================================================================
        try {
            const { checkGeminiHealth } = await import('@ai-swarm/shared');
            const geminiHealth = await checkGeminiHealth();

            healthResults.push({
                service: 'gemini-cli',
                status: geminiHealth.healthy ? 'healthy' : 'unhealthy',
                latencyMs: 0,
                message: geminiHealth.version || geminiHealth.error,
            });

            if (geminiHealth.healthy) {
                actionsTaken.push(`Gemini CLI: ${geminiHealth.version}`);
            } else {
                actionsTaken.push(`Gemini CLI: ${geminiHealth.error}`);
            }
        } catch {
            // Gemini health check is optional
        }

        // =======================================================================
        // DETERMINE OVERALL HEALTH
        // =======================================================================
        const unhealthyServices = healthResults.filter((r) => r.status === 'unhealthy');
        let healthStatus: SupervisorOutput['healthStatus'] = 'healthy';
        let escalated = false;

        if (unhealthyServices.length > 0) {
            if (unhealthyServices.some((s) => s.service === 'temporal')) {
                healthStatus = 'critical';
                escalated = true;
            } else {
                healthStatus = 'degraded';
            }
        }

        const result: SupervisorOutput = {
            healthStatus,
            actionsTaken,
            escalated,
        };

        const durationMs = Date.now() - startTime;
        logActivityComplete('supervisor', 'performHealthCheck', durationMs, true);

        return result;
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('supervisor', 'performHealthCheck', durationMs, false);

        return {
            healthStatus: 'critical',
            actionsTaken: [`Health check failed: ${error instanceof Error ? error.message : String(error)}`],
            escalated: true,
        };
    }
}

/**
 * Run garbage collection for old chats.
 */
export async function runCleanup(): Promise<{
    deletedTasks: number;
    deletedChats: number;
}> {
    const startTime = Date.now();
    logActivityStart('supervisor', 'runCleanup', {});

    try {
        const maxAgeDays = parseInt(process.env.CHAT_MAX_AGE_DAYS || '90', 10);
        const result = await cleanupOldChats(maxAgeDays);

        const durationMs = Date.now() - startTime;
        logActivityComplete('supervisor', 'runCleanup', durationMs, true);

        return result;
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('supervisor', 'runCleanup', durationMs, false);

        logger.error({ error }, 'Cleanup failed');
        return { deletedTasks: 0, deletedChats: 0 };
    }
}
