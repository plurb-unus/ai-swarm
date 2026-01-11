/**
 * AI Swarm v3.0.0 - System Workers API
 * 
 * Get worker health status.
 */

import { NextResponse } from 'next/server';
import { workerHealthService } from '@ai-swarm/shared';

// GET /api/system/workers - Get all worker health statuses
export async function GET() {
    try {
        const workers = await workerHealthService.getAllWorkerHealth();
        const configuredCount = await workerHealthService.getConfiguredWorkerCount();

        return NextResponse.json({
            workers,
            configuredCount,
            summary: {
                total: configuredCount,
                healthy: workers.filter(w => w.status === 'healthy').length,
                degraded: workers.filter(w => w.status === 'degraded').length,
                // Fix: getAllWorkerHealth() only returns active workers (never status='offline')
                // Offline count = configured - (healthy + degraded)
                offline: Math.max(0, configuredCount - workers.filter(w => w.status !== 'offline').length),
            }
        });
    } catch (error) {
        console.error('Failed to fetch worker health:', error);
        return NextResponse.json(
            { error: 'Failed to fetch worker health' },
            { status: 500 }
        );
    }
}
