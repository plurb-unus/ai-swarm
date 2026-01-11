'use client';

/**
 * AI Swarm v3.0.0 - Quick Start
 * Ordered setup checklist to replace internal help pages.
 */

import Link from 'next/link';
import {
    KeyRound,
    Cpu,
    GitBranch,
    TestTube2,
    Mail,
    FolderPlus,
    ShieldOff,
    ExternalLink,
    CheckCircle2,
    Circle,
    Code2,
    MessageSquare,
} from 'lucide-react';

interface SetupStep {
    id: string;
    title: string;
    description: string;
    icon: React.ReactNode;
    link: string;
    linkLabel: string;
    external?: boolean;
}

const setupSteps: SetupStep[] = [
    {
        id: 'auth',
        title: '1. Authentication',
        description: 'Sign in with a passkey or password. Passkeys are recommended for security.',
        icon: <KeyRound className="h-6 w-6" />,
        link: '/settings/security',
        linkLabel: 'Security Settings',
    },
    {
        id: 'llm',
        title: '2. Configure LLM Providers',
        description: 'Choose Gemini or Claude for each workflow role (Planner, Coder, Reviewer, Deployer).',
        icon: <Cpu className="h-6 w-6" />,
        link: '/settings/llm',
        linkLabel: 'LLM Configuration',
    },
    {
        id: 'scm',
        title: '3. Source Control Tokens',
        description: 'Add global Personal Access Tokens (PATs) for GitHub, GitLab, or Azure DevOps.',
        icon: <GitBranch className="h-6 w-6" />,
        link: '/settings/system',
        linkLabel: 'System Settings',
    },
    {
        id: 'playwright',
        title: '4. Playwright Credentials',
        description: 'Configure test email and password for automated browser verification of authenticated pages.',
        icon: <TestTube2 className="h-6 w-6" />,
        link: '/settings/system',
        linkLabel: 'System Settings',
    },
    {
        id: 'email',
        title: '5. Email Notifications',
        description: 'Set up Resend or SendGrid API key to receive workflow notifications.',
        icon: <Mail className="h-6 w-6" />,
        link: '/settings/system',
        linkLabel: 'System Settings',
    },
    {
        id: 'projects',
        title: '6. Add Projects',
        description: 'Create your first project by specifying a repository URL and optional per-project token.',
        icon: <FolderPlus className="h-6 w-6" />,
        link: '/settings/projects',
        linkLabel: 'Project Settings',
    },
    {
        id: 'blacklist',
        title: '7. Review Container Blacklist',
        description: 'Ensure critical containers (Temporal, Postgres, Redis) are protected from the LLM Deployer.',
        icon: <ShieldOff className="h-6 w-6" />,
        link: '/settings/llm',
        linkLabel: 'LLM Configuration',
    },
    {
        id: 'ide',
        title: '8. Configure IDE Integration',
        description: 'Set up your AI coding assistant (Cursor, Windsurf, VS Code) with AI Swarm\'s submission prompt.',
        icon: <Code2 className="h-6 w-6" />,
        link: 'https://ai-swarm.dev/docs/guide',
        linkLabel: 'IDE Integration Guide',
        external: true,
    },
    {
        id: 'first-task',
        title: '9. Start Your First Task',
        description: 'Submit a task via Chat & Plan or directly from your IDE to kick off an autonomous workflow.',
        icon: <MessageSquare className="h-6 w-6" />,
        link: '/submit',
        linkLabel: 'Chat & Plan',
    },
];

export default function QuickStartPage() {
    return (
        <main className="min-h-screen p-8">
            <div className="max-w-3xl mx-auto">
                <div className="flex items-center gap-4 mb-2">
                    <Link href="/" className="text-muted-foreground hover:text-foreground">
                        Dashboard
                    </Link>
                    <span className="text-muted-foreground">/</span>
                    <h1 className="text-2xl font-bold">Quick Start</h1>
                </div>
                <p className="text-muted-foreground mb-8">
                    Complete these steps to get AI Swarm running. For detailed documentation, visit{' '}
                    <a
                        href="https://ai-swarm.dev/docs"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                        ai-swarm.dev/docs <ExternalLink className="h-3 w-3" />
                    </a>
                </p>

                <div className="space-y-4">
                    {setupSteps.map((step) => (
                        <div
                            key={step.id}
                            className="card flex items-start gap-4 p-5 hover:border-primary/50 transition-colors"
                        >
                            <div className="flex-shrink-0 p-2 rounded-lg bg-primary/10 text-primary">
                                {step.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h2 className="font-semibold text-lg">{step.title}</h2>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {step.description}
                                </p>
                            </div>
                            <Link
                                href={step.link}
                                className="btn btn-secondary text-sm flex-shrink-0"
                            >
                                {step.linkLabel}
                            </Link>
                        </div>
                    ))}
                </div>

                <div className="mt-8 p-4 rounded-lg border border-border bg-muted/30">
                    <h3 className="font-medium mb-2">Need Help?</h3>
                    <p className="text-sm text-muted-foreground">
                        Full documentation is available at{' '}
                        <a
                            href="https://ai-swarm.dev/docs"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                        >
                            ai-swarm.dev/docs
                        </a>
                        . For issues, check our{' '}
                        <a
                            href="https://github.com/ai-swarm-dev/ai-swarm/issues"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                        >
                            GitHub issues
                        </a>
                        .
                    </p>
                </div>
            </div>
        </main>
    );
}
