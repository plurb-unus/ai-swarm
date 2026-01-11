import { Suspense } from 'react';
import { WorkflowList } from '@/components/WorkflowList';
import { AgentGrid } from '@/components/AgentGrid';
import { QuickStats } from '@/components/QuickStats';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function Dashboard() {
    return (
        <div className="space-y-8">
            {/* Quick Stats */}
            <section>
                <div className="mb-2" /> {/* Spacer */}
                <Suspense fallback={<StatsLoading />}>
                    <QuickStats />
                </Suspense>
            </section>

            {/* Agent Status */}
            <section>
                <h2 className="text-xl font-semibold mb-4 tracking-tight">Agent Status</h2>
                <AgentGrid />
            </section>

            {/* Recent Workflows */}
            <section>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold tracking-tight">Recent Activity</h2>
                    <a href="/workflows" className="text-primary text-sm hover:underline font-medium">
                        View all →
                    </a>
                </div>
                <Suspense fallback={<WorkflowLoading />}>
                    <WorkflowList limit={5} />
                </Suspense>
            </section>
        </div>
    );
}

function StatsLoading() {
    return (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
                <div key={i} className="card animate-pulse h-24" />
            ))}
        </div>
    );
}

function WorkflowLoading() {
    return (
        <div className="space-y-3">
            {[1, 2, 3].map((i) => (
                <div key={i} className="card animate-pulse h-20" />
            ))}
        </div>
    );
}
