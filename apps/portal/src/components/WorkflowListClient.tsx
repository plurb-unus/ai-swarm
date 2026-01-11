'use client';

import { useState, useEffect } from 'react';

interface WorkflowInfo {
    workflowId: string;
    runId: string;
    type: string;
    status: string;
    startTime: string;
}

type StatusFilter = 'ALL' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TERMINATED';

export function WorkflowListClient() {
    const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<StatusFilter>('ALL');
    const [terminating, setTerminating] = useState<string | null>(null);

    useEffect(() => {
        loadWorkflows();
    }, []);

    async function loadWorkflows() {
        try {
            setLoading(true);
            const res = await fetch('/api/workflows');
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setWorkflows(data.workflows || []);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load workflows');
        } finally {
            setLoading(false);
        }
    }

    async function terminateWorkflow(workflowId: string) {
        if (!confirm(`Are you sure you want to terminate ${workflowId}?`)) return;

        try {
            setTerminating(workflowId);
            const res = await fetch(`/api/workflows?workflowId=${encodeURIComponent(workflowId)}`, {
                method: 'DELETE',
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            // Refresh the list
            await loadWorkflows();
        } catch (e) {
            alert(e instanceof Error ? e.message : 'Failed to terminate workflow');
        } finally {
            setTerminating(null);
        }
    }

    function getStatusBadgeClass(status: string): string {
        if (status.includes('RUNNING')) return 'badge-blue';
        if (status === 'COMPLETED') return 'badge-green';
        if (status === 'COMPLETED_WITH_ERRORS') return 'badge-yellow';
        if (status === 'FIX_CREATED') return 'badge-yellow';
        if (status.includes('FAILED')) return 'badge-red';
        if (status.includes('TERMINATED') || status.includes('CANCELED') || status.includes('CANCELLED')) return 'badge-gray';
        return 'badge-gray';
    }

    function formatRelativeTime(dateStr: string): string {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        return `${diffDays}d ago`;
    }

    function matchesFilter(status: string): boolean {
        if (filter === 'ALL') return true;
        if (filter === 'RUNNING') return status.includes('RUNNING');
        if (filter === 'COMPLETED') return status === 'COMPLETED';
        if (filter === 'FAILED') return status.includes('FAILED') || status === 'COMPLETED_WITH_ERRORS' || status === 'FIX_CREATED';
        if (filter === 'TERMINATED') return status.includes('TERMINATED') || status.includes('CANCELED') || status.includes('CANCELLED');
        return true;
    }

    const filteredWorkflows = workflows.filter(wf => matchesFilter(wf.status));

    if (loading) {
        return (
            <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="card animate-pulse h-20" />
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <div className="card border-swarm-red/50">
                <div className="flex items-center gap-2 text-swarm-red">
                    <span>⚠️</span>
                    <span>Cannot connect to Temporal: {error}</span>
                </div>
            </div>
        );
    }

    return (
        <div>
            {/* Filter tabs */}
            <div className="flex gap-2 mb-4 flex-wrap">
                {(['ALL', 'RUNNING', 'COMPLETED', 'FAILED', 'TERMINATED'] as StatusFilter[]).map((f) => {
                    const count = workflows.filter(w => matchesFilter.call(null, w.status)).length; // Simplified for count
                    return (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-2 py-1 md:px-3 rounded-md text-xs md:text-sm transition-colors ${filter === f
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-card border border-border hover:border-primary/50'
                                }`}
                        >
                            {f}
                        </button>
                    );
                })}
                <button
                    onClick={loadWorkflows}
                    className="p-1 rounded-md text-xs md:text-sm bg-card border border-border hover:border-primary/50 ml-auto"
                    title="Refresh"
                >
                    ↻
                </button>
            </div>

            {/* Workflow list */}
            {filteredWorkflows.length === 0 ? (
                <div className="card text-center py-8">
                    <span className="text-4xl mb-4 block">📭</span>
                    <p className="text-swarm-muted">
                        {filter === 'ALL' ? 'No workflows yet' : `No ${filter.toLowerCase()} workflows`}
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {filteredWorkflows.map((wf) => (
                        <div key={wf.runId} className="p-3 rounded-lg border bg-card hover:border-primary/50 transition-colors">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h3 className="font-semibold truncate text-sm">{wf.workflowId}</h3>
                                        <span className={`badge shrink-0 scale-90 ${getStatusBadgeClass(wf.status)}`}>
                                            {wf.status.replace('WORKFLOW_EXECUTION_STATUS_', '').toLowerCase()}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
                                        <span>{wf.type}</span>
                                        <span className="hidden md:inline">•</span>
                                        <span>{formatRelativeTime(wf.startTime)}</span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 justify-end">
                                    {wf.status.includes('RUNNING') && (
                                        <button
                                            onClick={() => terminateWorkflow(wf.workflowId)}
                                            disabled={terminating === wf.workflowId}
                                            className="btn btn-ghost h-8 text-[10px] text-red-500 hover:text-red-600"
                                        >
                                            {terminating === wf.workflowId ? '...' : 'Terminate'}
                                        </button>
                                    )}
                                    <a
                                        href={`/temporal/namespaces/ai-swarm/workflows/${wf.workflowId}/${wf.runId}/history`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn btn-ghost h-8 text-[10px]"
                                    >
                                        History ↗
                                    </a>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
