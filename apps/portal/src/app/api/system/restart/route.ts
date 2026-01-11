/**
 * AI Swarm v3.0.0 - Swarm Restart API
 * 
 * Allows restarting the swarm containers to apply changes (e.g., worker count).
 * Uses the docker-socket-proxy for secure container management.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * POST /api/system/restart
 */
export async function POST() {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        console.log('AI Swarm restart requested...');

        // 1. Get list of all containers
        const containersRes = await fetch('http://socket-proxy:2375/containers/json?all=1');
        if (!containersRes.ok) throw new Error('Failed to reach docker socket proxy');

        const containers = await containersRes.json();

        // 2. Identify ai-swarm containers (excluding temporal/postgres for stability)
        const swarmContainers = containers.filter((c: any) =>
            c.Names.some((name: string) => name.includes('ai-swarm') || name.includes('ai_swarm'))
        );

        console.log(`Restarting ${swarmContainers.length} Swarm containers...`);

        // 3. Restart them
        const restartPromises = swarmContainers.map((c: any) =>
            fetch(`http://socket-proxy:2375/containers/${c.Id}/restart`, { method: 'POST' })
        );

        // Don't await all, as we might restart the portal itself which will kill this request
        Promise.all(restartPromises).catch(err => {
            console.error('Background restart failed:', err);
        });

        return NextResponse.json({
            success: true,
            message: 'Restart initiated. The portal may be unavailable for a few moments.',
            containerCount: swarmContainers.length
        });
    } catch (error) {
        console.error('Failed to restart swarm:', error);
        return NextResponse.json(
            { error: 'Failed to initiate restart: ' + (error instanceof Error ? error.message : String(error)) },
            { status: 500 }
        );
    }
}
