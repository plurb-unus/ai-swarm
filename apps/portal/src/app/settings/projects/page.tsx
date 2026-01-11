'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Project {
    id: string;
    name: string;
    scmProvider: string;
    scmOrg: string;
    scmProject?: string;
    scmRepo: string;
    isActive: boolean;
}

export default function ProjectsSettingsPage() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchProjects() {
            try {
                const res = await fetch('/api/projects');
                if (!res.ok) throw new Error('Failed to fetch projects');
                const data = await res.json();
                setProjects(data.projects);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Unknown error');
            } finally {
                setLoading(false);
            }
        }
        fetchProjects();
    }, []);

    if (loading) {
        return (
            <main className="min-h-screen p-8">
                <div className="max-w-4xl mx-auto">
                    <div className="animate-pulse">
                        <div className="h-8 bg-swarm-surface rounded w-1/4 mb-6"></div>
                        <div className="space-y-4">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="h-24 bg-swarm-surface rounded"></div>
                            ))}
                        </div>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen p-8">
            <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="text-muted-foreground hover:text-foreground">
                            Dashboard
                        </Link>
                        <span className="text-swarm-muted">/</span>
                        <h1 className="text-2xl font-bold">Projects</h1>
                    </div>
                    <Link href="/settings/projects/new" className="btn btn-primary">
                        Add Project
                    </Link>
                </div>

                {error && (
                    <div className="card border-swarm-red/50 mb-4">
                        <p className="text-swarm-red">{error}</p>
                    </div>
                )}

                {projects.length === 0 ? (
                    <div className="card text-center py-12">
                        <p className="text-swarm-muted mb-4">No projects configured yet.</p>
                        <Link href="/settings/projects/new" className="btn btn-primary">
                            Add Your First Project
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {projects.map(project => (
                            <Link
                                key={project.id}
                                href={`/settings/projects/${project.id}`}
                                className="card block hover:border-swarm-blue transition-colors"
                            >
                                <div className="flex items-start justify-between">
                                    <div>
                                        <h2 className="font-medium">{project.name}</h2>
                                        <p className="text-sm text-swarm-muted mt-1">
                                            {project.scmProvider} - {project.scmOrg}/{project.scmRepo}
                                        </p>
                                    </div>
                                    <span className={`badge ${project.isActive ? 'badge-running' : 'badge-failed'}`}>
                                        {project.isActive ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}
