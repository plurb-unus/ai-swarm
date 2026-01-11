'use client';

import Link from 'next/link';
import ProjectForm from '@/app/components/projects/ProjectForm';

export default function NewProjectPage() {
    return (
        <main className="min-h-screen p-8">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center gap-4 mb-6">
                    <Link href="/" className="text-muted-foreground hover:text-foreground">
                        Dashboard
                    </Link>
                    <span className="text-muted-foreground">/</span>
                    <Link href="/settings/projects" className="text-muted-foreground hover:text-foreground">
                        Projects
                    </Link>
                    <span className="text-muted-foreground">/</span>
                    <h1 className="text-2xl font-bold">New Project</h1>
                </div>

                <ProjectForm />
            </div>
        </main>
    );
}
