import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getTemporalClient } from '@/lib/temporal';


export async function POST(request: NextRequest) {
    // Check for authorization session
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { task, skipApproval, notifyOnComplete } = body;

        if (!task || !task.title) {
            return NextResponse.json(
                { error: 'Task title is required' },
                { status: 400 }
            );
        }

        const client = await getTemporalClient();

        const workflowId = `develop-${task.id || Date.now()}`;

        const handle = await client.workflow.start('developFeature', {
            taskQueue: 'ai-swarm-tasks',
            workflowId,
            args: [
                {
                    task: {
                        ...task,
                        createdAt: task.createdAt ? new Date(task.createdAt) : new Date(),
                    },
                    skipApproval: skipApproval ?? false,
                    notifyOnComplete: notifyOnComplete ?? true,
                },
            ],
        });

        return NextResponse.json({
            success: true,
            workflowId: handle.workflowId,
            runId: handle.firstExecutionRunId,
        });
    } catch (error) {
        console.error('Failed to start workflow:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to start workflow' },
            { status: 500 }
        );
    }
}

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const client = await getTemporalClient();
        const workflows: any[] = [];

        const iterator = client.workflow.list();

        let count = 0;
        for await (const wf of iterator) {
            if (count >= 50) break;
            // FIX: Map status Enum to string
            let status = (wf.status as any).name || 'UNKNOWN';

            // For completed workflows, fetch the actual result to get the task status
            if (status === 'COMPLETED') {
                try {
                    const handle = client.workflow.getHandle(wf.workflowId, wf.runId);
                    const result = await handle.result();
                    if (result?.status) {
                        // Map workflow result status to display status
                        switch (result.status) {
                            case 'completed':
                                status = 'COMPLETED';
                                break;
                            case 'failed':
                                status = 'FAILED';
                                break;
                            case 'completed_with_errors':
                                status = 'COMPLETED_WITH_ERRORS';
                                break;
                            case 'fix_task_created':
                                status = 'FIX_CREATED';
                                break;
                            case 'cancelled':
                                status = 'CANCELLED';
                                break;
                            default:
                                // Keep COMPLETED if status is unknown
                                break;
                        }
                    }
                } catch {
                    // Keep original status if we can't get the result
                }
            }

            workflows.push({
                workflowId: wf.workflowId,
                runId: wf.runId,
                type: wf.type,
                status: status,
                startTime: wf.startTime,
            });
            count++;
        }

        return NextResponse.json({ workflows });
    } catch (error) {
        console.error('Failed to list workflows:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to list workflows' },
            { status: 500 }
        );
    }
}

export async function DELETE(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const workflowId = searchParams.get('workflowId');

        if (!workflowId) {
            return NextResponse.json(
                { error: 'workflowId is required' },
                { status: 400 }
            );
        }

        const client = await getTemporalClient();
        const handle = client.workflow.getHandle(workflowId);

        await handle.terminate('Terminated by user from portal');

        return NextResponse.json({
            success: true,
            message: `Workflow ${workflowId} terminated`
        });
    } catch (error) {
        console.error('Failed to terminate workflow:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to terminate workflow' },
            { status: 500 }
        );
    }
}

