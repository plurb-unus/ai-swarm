import Link from 'next/link';

interface WorkflowPageProps {
    params: Promise<{ id: string }>;
}

export default async function WorkflowSubmittedPage({ params }: WorkflowPageProps) {
    const { id: workflowId } = await params;

    // Build Temporal URL from environment (server-side)
    // Priority: TEMPORAL_UI_URL (full URL) > PORTAL_DOMAIN/temporal > localhost
    let temporalBaseUrl: string;
    if (process.env.TEMPORAL_UI_URL) {
        // Full URL provided (e.g., https://dev.ai-swarm.dev/temporal)
        temporalBaseUrl = process.env.TEMPORAL_UI_URL;
    } else if (process.env.PORTAL_DOMAIN) {
        // Construct from portal domain with /temporal path
        temporalBaseUrl = `https://${process.env.PORTAL_DOMAIN}/temporal`;
    } else {
        // Local development fallback
        temporalBaseUrl = 'http://localhost:8233';
    }
    const temporalUrl = `${temporalBaseUrl}/namespaces/ai-swarm/workflows/${workflowId}`;

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <div className="card max-w-lg w-full text-center p-8">
                {/* Success icon */}
                <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-500/20 flex items-center justify-center">
                    <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                </div>

                <h1 className="text-2xl font-bold mb-2">Task Submitted!</h1>
                <p className="text-swarm-muted mb-6">
                    Your task has been sent to the AI Swarm and is now being processed.
                </p>

                {/* Workflow ID */}
                <div className="bg-swarm-bg border border-swarm-border rounded-md p-3 mb-6">
                    <p className="text-xs text-swarm-muted mb-1">Workflow ID</p>
                    <code className="text-sm font-mono text-swarm-blue break-all">{workflowId}</code>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-3">
                    <a
                        href={temporalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary inline-flex items-center justify-center gap-2"
                    >
                        View in Temporal
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                    </a>
                    <Link href="/workflows" className="btn btn-ghost">
                        ← Back to Workflows
                    </Link>
                </div>

                {/* Info */}
                <p className="text-xs text-swarm-muted mt-6">
                    You&apos;ll receive an email notification when the task completes.
                </p>
            </div>
        </div>
    );
}
