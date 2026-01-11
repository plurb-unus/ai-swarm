'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import ProjectForm, { Project, Deployment } from '@/app/components/projects/ProjectForm';

export default function ProjectDetailPage() {
    const params = useParams();
    const id = params.id as string;
    const [project, setProject] = useState<Project | null>(null);
    const [deployment, setDeployment] = useState<Deployment | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [savingStatus, setSavingStatus] = useState(false);

    useEffect(() => {
        async function fetchProject() {
            try {
                const res = await fetch(`/api/projects/${id}`);
                if (!res.ok) throw new Error('Project not found');
                const data = await res.json();
                setProject(data.project);
                setDeployment(data.deployment || {
                    sshHost: 'host.docker.internal',
                    sshUser: 'ubuntu',
                    deployDir: '',
                    appUrl: ''
                });
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to fetch project');
            } finally {
                setLoading(false);
            }
        }
        fetchProject();
    }, [id]);

    async function toggleStatus() {
        if (!project) return;
        const newStatus = !project.isActive;
        setSavingStatus(true);
        try {
            const res = await fetch(`/api/projects/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...project, isActive: newStatus }),
            });
            if (!res.ok) throw new Error('Failed to update status');
            const updatedData = await res.json();
            setProject(updatedData.project);
        } catch (err) {
            console.error('Failed to toggle status', err);
        } finally {
            setSavingStatus(false);
        }
    }

    if (loading) {
        return (
            <main className="min-h-screen p-8">
                <div className="max-w-7xl mx-auto animate-pulse">
                    <div className="h-8 bg-swarm-surface rounded w-1/3 mb-6"></div>
                    <div className="h-64 bg-swarm-surface rounded"></div>
                </div>
            </main>
        );
    }

    if (!project && error) {
        return (
            <main className="min-h-screen p-8 text-center">
                <h1 className="text-2xl font-bold mb-4">Error</h1>
                <p className="text-swarm-red mb-6">{error}</p>
                <Link href="/settings/projects" className="btn btn-primary">
                    Back to Projects
                </Link>
            </main>
        );
    }

    return (
        <main className="min-h-screen p-8">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="text-muted-foreground hover:text-foreground">
                            Dashboard
                        </Link>
                        <span className="text-muted-foreground">/</span>
                        <Link href="/settings/projects" className="text-muted-foreground hover:text-foreground">
                            Projects
                        </Link>
                        <span className="text-muted-foreground">/</span>
                        <h1 className="text-2xl font-bold">{project?.name}</h1>
                    </div>
                    <button
                        onClick={toggleStatus}
                        disabled={savingStatus}
                        className={`badge cursor-pointer transition-colors ${project?.isActive ? 'badge-running hover:bg-emerald-500/20' : 'badge-failed hover:bg-red-500/20'}`}
                    >
                        {savingStatus ? 'Saving...' : (project?.isActive ? 'Active' : 'Inactive')}
                    </button>
                </div>

                <ProjectForm
                    initialProject={project!}
                    initialDeployment={deployment || undefined}
                    isEditing={true}
                />
            </div>
        </main>
    );
}
