/**
 * Temporal Client Singleton
 */

import { Client, Connection } from '@temporalio/client';

let client: Client | null = null;

export async function getTemporalClient(): Promise<Client> {
    if (client) {
        return client;
    }

    const connection = await Connection.connect({
        address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });

    client = new Client({
        connection,
        namespace: process.env.TEMPORAL_NAMESPACE || 'ai-swarm',
    });

    return client;
}

/**
 * Workflow status helper
 */
export function getStatusBadgeClass(status: string): string {
    switch (status) {
        case 'Running':
        case 'RUNNING':
            return 'badge-running';
        case 'Completed':
        case 'COMPLETED':
            return 'badge-completed';
        case 'Failed':
        case 'FAILED':
        case 'Terminated':
        case 'TERMINATED':
            return 'badge-failed';
        default:
            return 'badge-pending';
    }
}

/**
 * Format duration from milliseconds
 */
export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/**
 * Format relative time
 */
export function formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString();
}
