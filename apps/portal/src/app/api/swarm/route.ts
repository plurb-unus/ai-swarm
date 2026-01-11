import { NextRequest, NextResponse } from 'next/server';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * GET /api/swarm/status
 * Get the current swarm status (paused or running)
 */
export async function GET() {
    const redis = new Redis(REDIS_URL);

    try {
        const paused = await redis.get('swarm:paused');
        const pausedAt = await redis.get('swarm:paused_at');
        const pausedBy = await redis.get('swarm:paused_by');

        return NextResponse.json({
            status: paused === 'true' ? 'paused' : 'running',
            paused: paused === 'true',
            pausedAt: pausedAt || null,
            pausedBy: pausedBy || null,
        });
    } catch (error) {
        console.error('Failed to get swarm status:', error);
        return NextResponse.json(
            { error: 'Failed to get swarm status' },
            { status: 500 }
        );
    } finally {
        await redis.quit();
    }
}

/**
 * POST /api/swarm
 * Control the swarm (pause/resume)
 * Body: { action: 'pause' | 'resume', reason?: string }
 */
export async function POST(request: NextRequest) {
    const redis = new Redis(REDIS_URL);

    try {
        const body = await request.json();
        const { action, reason } = body;

        if (action === 'pause') {
            await redis.set('swarm:paused', 'true');
            await redis.set('swarm:paused_at', new Date().toISOString());
            if (reason) {
                await redis.set('swarm:paused_reason', reason);
            }

            console.log('Swarm PAUSED:', reason || 'No reason provided');

            return NextResponse.json({
                success: true,
                status: 'paused',
                message: 'Swarm has been paused. No new tasks will be processed.',
            });
        } else if (action === 'resume') {
            await redis.del('swarm:paused');
            await redis.del('swarm:paused_at');
            await redis.del('swarm:paused_reason');
            await redis.del('swarm:paused_by');

            console.log('Swarm RESUMED');

            return NextResponse.json({
                success: true,
                status: 'running',
                message: 'Swarm has been resumed. Tasks will be processed normally.',
            });
        } else {
            return NextResponse.json(
                { error: 'Invalid action. Use "pause" or "resume".' },
                { status: 400 }
            );
        }
    } catch (error) {
        console.error('Failed to control swarm:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to control swarm' },
            { status: 500 }
        );
    } finally {
        await redis.quit();
    }
}
