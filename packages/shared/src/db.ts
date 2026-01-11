/**
 * AI Swarm v3.0.0 - Database Connection Pool
 * 
 * Singleton connection pool for PostgreSQL. Used by all services that need DB access.
 */

import { Pool } from 'pg';

let pool: Pool | null = null;

/**
 * Get the shared PostgreSQL connection pool.
 * Creates the pool on first call, returns the same instance on subsequent calls.
 */
export function getPool(): Pool {
    if (!pool) {
        pool = new Pool({
            user: process.env.POSTGRES_USER || 'temporal',
            host: process.env.POSTGRES_HOST || 'postgres',
            database: process.env.POSTGRES_DB || 'postgres',
            password: process.env.POSTGRES_PASSWORD || 'temporal',
            port: parseInt(process.env.POSTGRES_PORT || '5432'),
        });
    }
    return pool;
}

/**
 * Close the connection pool. Call during graceful shutdown.
 */
export async function closePool(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
    }
}
