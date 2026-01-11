/**
 * AI Swarm v3.0.0 - Worker Health Service
 * 
 * Redis-based worker health tracking. Workers publish heartbeats, portal polls status.
 */

import { Redis } from 'ioredis';
import { logger } from '../logger.js';
import { getPool } from '../db.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const HEARTBEAT_KEY_PREFIX = 'worker:health:';
const HEARTBEAT_TTL_SECONDS = 90; // Mark as offline if no heartbeat for 90s

export interface WorkerHealth {
    workerId: string;
    status: 'healthy' | 'degraded' | 'offline';
    lastHeartbeat: Date;
    currentTask?: string;
    llmProvider?: 'gemini' | 'claude';
    authStatus?: { claude: boolean; gemini: boolean; };
    metadata?: Record<string, unknown>;
}

export interface WorkerHeartbeat {
    workerId: string;
    status: 'healthy' | 'degraded';
    currentTask?: string;
    llmProvider?: 'gemini' | 'claude';
    authStatus?: { claude: boolean; gemini: boolean; };
    metadata?: Record<string, unknown>;
}

export class WorkerHealthService {
    private redis: Redis | null = null;

    private getRedis(): Redis {
        if (!this.redis) {
            this.redis = new Redis(REDIS_URL);
        }
        return this.redis;
    }

    /**
     * Publish a heartbeat from a worker
     */
    async publishHeartbeat(heartbeat: WorkerHeartbeat): Promise<void> {
        const redis = this.getRedis();
        const key = `${HEARTBEAT_KEY_PREFIX}${heartbeat.workerId}`;

        const data = {
            ...heartbeat,
            lastHeartbeat: new Date().toISOString()
        };

        await redis.setex(key, HEARTBEAT_TTL_SECONDS, JSON.stringify(data));

        // Also persist to DB for history (optional, async)
        this.persistToDb(heartbeat).catch(err =>
            logger.warn({ err, workerId: heartbeat.workerId }, 'Failed to persist heartbeat to DB')
        );
    }

    /**
     * Get health status for all workers
     */
    async getAllWorkerHealth(): Promise<WorkerHealth[]> {
        const redis = this.getRedis();
        const keys = await redis.keys(`${HEARTBEAT_KEY_PREFIX}*`);

        if (keys.length === 0) {
            // Return configured worker count as offline
            const configuredCount = await this.getConfiguredWorkerCount();
            return Array.from({ length: configuredCount }, (_, i) => ({
                workerId: `worker-${i + 1}`,
                status: 'offline' as const,
                lastHeartbeat: new Date(0)
            }));
        }

        const pipeline = redis.pipeline();
        keys.forEach((key: string) => pipeline.get(key));
        const results = await pipeline.exec();

        const healthStatuses: WorkerHealth[] = [];

        if (results) {
            for (const [err, result] of results) {
                if (!err && result) {
                    try {
                        const data = JSON.parse(result as string);
                        healthStatuses.push({
                            workerId: data.workerId,
                            status: data.status,
                            lastHeartbeat: new Date(data.lastHeartbeat),
                            currentTask: data.currentTask,
                            llmProvider: data.llmProvider,
                            authStatus: data.authStatus,
                            metadata: data.metadata
                        });
                    } catch (e) {
                        // Skip malformed entries
                    }
                }
            }
        }

        // Legacy logic removed: We no longer assume workers are named worker-1...worker-N
        // Dynamic replicas use container IDs or random strings.
        // We only report what is actually in Redis (active/recent).
        // If we want to show "missing" workers, we'd need to compare count vs active,
        // but we can't guess their names.

        return healthStatuses.sort((a, b) => a.workerId.localeCompare(b.workerId));
    }

    /**
     * Get configured worker count - returns actual running workers from Redis
     * v3.0.0: Changed to reflect reality (running workers) instead of DB config
     */
    async getConfiguredWorkerCount(): Promise<number> {
        try {
            // Get actual healthy worker count from Redis heartbeats
            const workers = await this.getAllWorkerHealth();
            const healthyCount = workers.filter(w => w.status === 'healthy').length;
            if (healthyCount > 0) return healthyCount;
        } catch (err) {
            logger.warn({ err }, 'Failed to get worker count from Redis, using env default');
        }
        // Fallback to env var if no workers reporting
        return parseInt(process.env.WORKER_COUNT || '4', 10);
    }

    /**
     * Set configured worker count
     */
    async setConfiguredWorkerCount(count: number): Promise<void> {
        const pool = getPool();
        await pool.query(
            `INSERT INTO system_config (key, value, updated_at) 
             VALUES ('worker_count', $1, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
            [count.toString()]
        );
    }

    /**
     * Persist heartbeat to database for history
     */
    private async persistToDb(heartbeat: WorkerHeartbeat): Promise<void> {
        const pool = getPool();
        await pool.query(
            `INSERT INTO worker_health (worker_id, status, last_heartbeat, current_task_id, llm_provider, metadata)
             VALUES ($1, $2, NOW(), $3, $4, $5)
             ON CONFLICT (worker_id) DO UPDATE SET
                status = EXCLUDED.status,
                last_heartbeat = NOW(),
                current_task_id = EXCLUDED.current_task_id,
                llm_provider = EXCLUDED.llm_provider,
                metadata = EXCLUDED.metadata`,
            [
                heartbeat.workerId,
                heartbeat.status,
                heartbeat.currentTask || null,
                heartbeat.llmProvider || null,
                heartbeat.metadata ? JSON.stringify(heartbeat.metadata) : null
            ]
        );
    }

    /**
     * Close Redis connection
     */
    async close(): Promise<void> {
        if (this.redis) {
            await this.redis.quit();
            this.redis = null;
        }
    }
}

export const workerHealthService = new WorkerHealthService();
