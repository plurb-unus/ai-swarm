import { NextResponse } from 'next/server';
import { systemConfigService, logger } from '@ai-swarm/shared';

export async function POST(request: Request) {
    try {
        const body = await request.json();

        if (body.complete === true) {
            await systemConfigService.setConfig('onboarding_complete', 'true');
            logger.info('Onboarding marked as complete');
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    } catch (err) {
        logger.error({ err }, 'Failed to update onboarding status');
        return NextResponse.json({ error: 'Failed to update onboarding status' }, { status: 500 });
    }
}
