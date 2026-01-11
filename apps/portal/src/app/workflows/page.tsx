import { WorkflowListClient } from '@/components/WorkflowListClient';

export const dynamic = 'force-dynamic';

export default function WorkflowsPage() {
    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold">All Workflows</h1>
                <a href="/submit" className="btn btn-primary">
                    + New Task
                </a>
            </div>

            <WorkflowListClient />
        </div>
    );
}

