import { getTemporalClient, getStatusBadgeClass, formatRelativeTime } from '@/lib/temporal';


interface WorkflowListProps {
    limit?: number;
}

interface WorkflowInfo {
    workflowId: string;
    runId: string;
    type: string;
    status: string;
    startTime: Date;
}

export async function WorkflowList({ limit = 10 }: WorkflowListProps) {
    let workflows: WorkflowInfo[] = [];
    let error: string | null = null;

    try {
        const client = await getTemporalClient();
        const iterator = client.workflow.list();

        let count = 0;
        for await (const wf of iterator) {
            if (count >= limit) break;
            // FIX: Map status Enum to string
            // FIX: Map status using integers (Enum import is unstable)
            const status = (wf.status as any).name || 'UNKNOWN';

            workflows.push({
                workflowId: wf.workflowId,
                runId: wf.runId,
                type: wf.type,
                status: status,
                startTime: wf.startTime,
            });
            count++;
        }
    } catch (e) {
        console.error('Failed to list workflows:', e);
        error = e instanceof Error ? e.message : 'Failed to connect to Temporal';
    }

    if (error) {
        return (
            <div className="card border-swarm-red/50">
                <div className="flex items-center gap-2 text-swarm-red">
                    <span>⚠️</span>
                    <span>Cannot connect to Temporal: {error}</span>
                </div>
                <p className="text-sm text-swarm-muted mt-2">
                    Make sure Temporal is running at {process.env.TEMPORAL_ADDRESS || 'localhost:7233'}
                </p>
            </div>
        );
    }

    if (workflows.length === 0) {
        return (
            <div className="card text-center py-8">
                <span className="text-4xl mb-4 block">📭</span>
                <p className="text-swarm-muted">No workflows yet</p>
                <a href="/submit" className="btn btn-primary mt-4 inline-block">
                    Create your first task
                </a>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {workflows.map((wf) => (
                <WorkflowCard key={wf.runId} workflow={wf} />
            ))}
        </div>
    );
}

function WorkflowCard({ workflow }: { workflow: WorkflowInfo }) {
    return (
        <div className="card hover:border-swarm-blue/50 transition-colors">
            <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className="font-medium truncate">{workflow.workflowId}</h3>
                        <span className={`badge ${getStatusBadgeClass(workflow.status)}`}>
                            {workflow.status}
                        </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-sm text-swarm-muted">
                        <span>{workflow.type}</span>
                        <span>•</span>
                        <span>{formatRelativeTime(workflow.startTime)}</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <a
                        href={`/temporal/namespaces/ai-swarm/workflows/${workflow.workflowId}/${workflow.runId}/history`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost text-xs"
                    >
                        View Details ↗
                    </a>
                </div>
            </div>
        </div>
    );
}
