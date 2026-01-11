import { NextResponse } from 'next/server';
import { workerHealthService, systemStatusService, logger } from '@ai-swarm/shared';

export async function POST() {
    try {
        // 1. Check Portal's local authentication status
        const portalStatus = await systemStatusService.checkAuthStatus();

        // 2. Get active workers from health service
        // 2. Get all worker health from health service
        const allWorkers = await workerHealthService.getAllWorkerHealth();
        const workers = allWorkers.filter(w => w.status !== 'offline');

        // 3. For now, we'll return the portal status + the list of workers
        // In a full implementation, we would trigger a "Diagnostic Workflow"
        // that runs on each worker's unique task queue if available.
        // For this phase, we'll combine the manual report with the heartbeat data.

        const report = {
            portal: {
                id: 'portal',
                ...portalStatus
            },
            workers: workers.map(w => {
                const claudeAuth = w.authStatus?.claude ?? (w.llmProvider === 'claude' && w.status === 'healthy');
                const geminiAuth = w.authStatus?.gemini ?? (w.llmProvider === 'gemini' && w.status === 'healthy');

                return {
                    id: w.workerId,
                    status: w.status,
                    lastHeartbeat: w.lastHeartbeat,
                    llmProvider: w.llmProvider,
                    claude: {
                        authenticated: claudeAuth,
                        message: claudeAuth ? 'Authenticated' : 'Requires Login'
                    },
                    gemini: {
                        authenticated: geminiAuth,
                        message: geminiAuth ? 'Authenticated' : 'Requires Login'
                    }
                };
            })
        };

        return NextResponse.json(report);
    } catch (err) {
        logger.error({ err }, 'Failed to check auth status');
        return NextResponse.json({ error: 'Failed to perform auth check' }, { status: 500 });
    }
}
