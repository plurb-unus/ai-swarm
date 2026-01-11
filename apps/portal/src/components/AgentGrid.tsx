'use client';

import { useEffect, useState } from 'react';

interface WorkerHealth {
    workerId: string;
    status: 'healthy' | 'degraded' | 'offline';
    lastHeartbeat: string;
    currentTask?: string;
    llmProvider?: 'gemini' | 'claude';
}

interface WorkersResponse {
    workers: WorkerHealth[];
    configuredCount: number;
    summary: {
        total: number;
        healthy: number;
        degraded: number;
        offline: number;
    };
}

export function AgentGrid() {
    const [data, setData] = useState<WorkersResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchWorkers() {
            try {
                const res = await fetch('/api/system/workers');
                if (!res.ok) throw new Error('Failed to fetch workers');
                const json = await res.json();
                setData(json);
                setError(null);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Unknown error');
            } finally {
                setLoading(false);
            }
        }

        fetchWorkers();
        // Refresh every 15 seconds
        const interval = setInterval(fetchWorkers, 15000);
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="card animate-pulse">
                        <div className="h-4 bg-swarm-surface rounded w-1/2 mb-3"></div>
                        <div className="h-3 bg-swarm-surface rounded w-3/4"></div>
                    </div>
                ))}
            </div>
        );
    }



    if (error) {
        return (
            <div className="card border-destructive/50 bg-destructive/10">
                <p className="text-destructive">Failed to load worker status: {error}</p>
            </div>
        );
    }

    if (!data || data.workers.length === 0) {
        return (
            <div className="card">
                <p className="text-muted-foreground">No workers configured</p>
            </div>
        );
    }

    return (
        <div>
            {/* Summary Bar */}
            <div className="flex flex-wrap gap-2 md:gap-4 mb-4 text-xs md:text-sm">
                <span className="text-muted-foreground bg-muted/30 px-2 py-1 rounded">
                    Workers: <span className="text-foreground font-medium">{data.configuredCount}</span>
                </span>
                <span className="text-green-600 dark:text-green-400 bg-green-500/10 px-2 py-1 rounded">
                    Healthy: {data.summary.healthy}
                </span>
                {data.summary.degraded > 0 && (
                    <span className="text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded">
                        Degraded: {data.summary.degraded}
                    </span>
                )}
                {data.summary.offline > 0 && (
                    <span className="text-red-600 dark:text-red-400 bg-red-500/10 px-2 py-1 rounded">
                        Offline: {data.summary.offline}
                    </span>
                )}
            </div>

            {/* Worker Cards - include placeholders for missing workers */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                {data.workers.map((worker) => (
                    <WorkerCard key={worker.workerId} worker={worker} />
                ))}
                {/* Placeholder cards for offline/missing workers */}
                {data.summary.offline > 0 && Array.from({ length: data.summary.offline }, (_, i) => (
                    <WorkerCard
                        key={`offline-${i}`}
                        worker={{
                            workerId: `worker-${data.workers.length + i + 1}`,
                            status: 'offline',
                            lastHeartbeat: '',
                        }}
                    />
                ))}
            </div>
        </div>
    );
}

function WorkerCard({ worker }: { worker: WorkerHealth }) {
    const statusColors = {
        healthy: 'bg-green-500',
        degraded: 'bg-yellow-500',
        offline: 'bg-red-500 opacity-50',
    };

    const statusBadges = {
        healthy: 'bg-green-500/10 text-green-600 dark:text-green-400',
        degraded: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
        offline: 'bg-red-500/10 text-red-600 dark:text-red-400',
    };

    const lastSeen = worker.lastHeartbeat
        ? new Date(worker.lastHeartbeat).toLocaleTimeString()
        : 'Never';

    return (
        <div className={`p-3 md:p-4 rounded-lg border bg-card text-card-foreground shadow-sm transition-all hover:shadow-md ${worker.status === 'offline' ? 'opacity-60 grayscale' : ''}`}>
            <div className="flex items-start justify-between mb-2 md:mb-3">
                <div className="min-w-0">
                    <h3 className="font-semibold text-xs md:text-sm truncate">{worker.workerId}</h3>
                    <p className="text-[10px] md:text-xs text-muted-foreground">
                        {worker.currentTask ? 'Running' : 'Idle'}
                    </p>
                </div>
                <span className={`px-1.5 py-0.5 rounded-full text-[8px] md:text-[10px] font-medium uppercase tracking-wider whitespace-nowrap ${statusBadges[worker.status]}`}>
                    {worker.status}
                </span>
            </div>

            {worker.currentTask && (
                <div className="mb-2 md:mb-3 p-1.5 md:p-2 rounded bg-muted/50 text-[10px] md:text-xs">
                    <span className="text-muted-foreground block mb-0.5">Task:</span>
                    <code className="font-mono text-foreground truncate block">{worker.currentTask.slice(0, 8)}...</code>
                </div>
            )}

            {/* Activity indicator */}
            <div className="flex items-center gap-1.5 md:gap-2 text-[10px] md:text-xs text-muted-foreground border-t border-border pt-2 md:pt-3 mt-1 md:mt-2">
                <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${statusColors[worker.status]} ${worker.status === 'healthy' ? 'animate-pulse' : ''}`} />
                <span className="truncate">Seen: {lastSeen}</span>
            </div>
        </div>
    );
}

