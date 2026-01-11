'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';

export interface Project {
    id?: string;
    name: string;
    scmProvider: string;
    scmOrg: string;
    scmProject?: string;
    scmRepo: string;
    scmToken?: string;
    projectFolder: string;
    aiContextFolder: string;
    isActive?: boolean;
}

export interface Deployment {
    sshHost: string;
    sshUser: string;
    deployDir: string;
    appUrl?: string;
    metadata?: Record<string, any>;
}

interface ProjectFormProps {
    initialProject?: Project;
    initialDeployment?: Deployment;
    isEditing?: boolean;
}

export default function ProjectForm({ initialProject, initialDeployment, isEditing = false }: ProjectFormProps) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [showToken, setShowToken] = useState(false);

    // For specialized SCM help text
    const [scmProvider, setScmProvider] = useState(initialProject?.scmProvider || '');

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccess(false);

        const formData = new FormData(e.currentTarget);
        const data = {
            name: formData.get('name'),
            scmProvider: formData.get('scmProvider'),
            scmOrg: formData.get('scmOrg'),
            scmProject: formData.get('scmProject') || undefined,
            scmRepo: formData.get('scmRepo'),
            scmToken: formData.get('scmToken') as string, // Empty string clears the token
            projectFolder: formData.get('projectFolder'),
            aiContextFolder: formData.get('aiContextFolder'),
            isActive: initialProject?.isActive ?? true,
            // Deployment data is always sent now
            deployment: {
                sshHost: formData.get('sshHost'),
                sshUser: formData.get('sshUser'),
                deployDir: formData.get('deployDir'),
                appUrl: formData.get('appUrl'),
                deployServices: formData.get('deployServices'),
            }
        };

        try {
            const endpoint = isEditing ? `/api/projects/${initialProject?.id}` : '/api/projects';
            const method = isEditing ? 'PUT' : 'POST';

            const res = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to save project');
            }

            if (isEditing) {
                setSuccess(true);
                setTimeout(() => setSuccess(false), 3000);
            } else {
                router.push('/settings/projects');
                router.refresh();
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete() {
        if (!confirm('Are you sure you want to delete this project? This cannot be undone.')) return;
        setDeleting(true);
        setError(null);

        try {
            const res = await fetch(`/api/projects/${initialProject?.id}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to delete project');
            router.push('/settings/projects');
            router.refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            setDeleting(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
                <div className="card border-swarm-red/50">
                    <p className="text-swarm-red">{error}</p>
                </div>
            )}

            {success && (
                <div className="card border-swarm-green/50 text-sm text-swarm-green">
                    Project saved successfully.
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Configuration */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="card space-y-4">
                        <h2 className="text-lg font-semibold border-b border-border pb-2">Core Settings</h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium mb-1">Project Name</label>
                                <input
                                    type="text"
                                    name="name"
                                    required
                                    defaultValue={initialProject?.name}
                                    className="input w-full"
                                    placeholder="e.g., MyApp"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1 text-muted-foreground group">
                                    SCM Provider
                                    <span className="invisible group-hover:visible ml-2 text-[10px] uppercase tracking-widest text-swarm-blue">Required</span>
                                </label>
                                <select
                                    name="scmProvider"
                                    required
                                    defaultValue={initialProject?.scmProvider}
                                    onChange={(e) => setScmProvider(e.target.value)}
                                    className="input w-full"
                                >
                                    <option value="">Select Provider...</option>
                                    <option value="azure-devops">Azure DevOps</option>
                                    <option value="github">GitHub</option>
                                    <option value="gitlab">GitLab</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">Organization</label>
                                <input
                                    type="text"
                                    name="scmOrg"
                                    required
                                    defaultValue={initialProject?.scmOrg}
                                    className="input w-full"
                                    placeholder="e.g., my-org"
                                />
                            </div>

                            <div className={scmProvider === 'azure-devops' ? 'block' : 'hidden'}>
                                <label className="block text-sm font-medium mb-1">Project</label>
                                <input
                                    type="text"
                                    name="scmProject"
                                    defaultValue={initialProject?.scmProject}
                                    className="input w-full"
                                    placeholder="e.g., dev_ops"
                                />
                            </div>

                            <div className={scmProvider === 'azure-devops' ? '' : 'md:col-span-2'}>
                                <label className="block text-sm font-medium mb-1">Repository</label>
                                <input
                                    type="text"
                                    name="scmRepo"
                                    required
                                    defaultValue={initialProject?.scmRepo}
                                    className="input w-full"
                                    placeholder="e.g., my-repo"
                                />
                            </div>

                            <div className="md:col-span-2 text-xs text-muted-foreground p-2 bg-swarm-surface/50 rounded border border-border/50">
                                {scmProvider === 'github' && <span>URL: https://github.com/<span className="text-swarm-blue">[Org]</span>/<span className="text-swarm-blue">[Repo]</span>.git</span>}
                                {scmProvider === 'gitlab' && <span>URL: https://gitlab.com/<span className="text-swarm-blue">[Org]</span>/<span className="text-swarm-blue">[Repo]</span>.git</span>}
                                {scmProvider === 'azure-devops' && <span>URL: https://dev.azure.com/<span className="text-swarm-blue">[Org]</span>/<span className="text-swarm-blue">[Project]</span>/_git/<span className="text-swarm-blue">[Repo]</span></span>}
                                {!scmProvider && <span>Select a provider to see URL structure.</span>}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">SCM Token (Optional)</label>
                            <div className="relative">
                                <input
                                    type={showToken ? 'text' : 'password'}
                                    name="scmToken"
                                    defaultValue={initialProject?.scmToken || ''}
                                    className="input w-full pr-10"
                                    placeholder="Leave blank to use Global SCM Token"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowToken(!showToken)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                Use if this project requires a specific token different from global settings.
                            </p>
                        </div>
                    </div>

                    <div className="card space-y-4">
                        <h2 className="text-lg font-semibold border-b border-border pb-2">Deployment & Environment</h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Project Folder (Container Path) <span className="text-swarm-red">*</span></label>
                                <input
                                    type="text"
                                    name="projectFolder"
                                    required
                                    defaultValue={initialProject?.projectFolder || ''}
                                    className="input w-full"
                                    placeholder="/apps/my-app"
                                />
                                <p className="text-[10px] text-muted-foreground mt-1">
                                    Path inside the worker container where files are accessed.
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">AI Context (Relative)</label>
                                <input
                                    type="text"
                                    name="aiContextFolder"
                                    required
                                    defaultValue={initialProject?.aiContextFolder || '.aicontext'}
                                    className="input w-full"
                                />
                                <p className="text-[10px] text-muted-foreground mt-1">
                                    Documentation folder relative to project root.
                                </p>
                            </div>

                            <div className="md:col-span-2 border-t border-border/50 pt-4"></div>

                            <div>
                                <label className="block text-sm font-medium mb-1">SSH Host</label>
                                <input
                                    type="text"
                                    name="sshHost"
                                    defaultValue={initialDeployment?.sshHost || 'host.docker.internal'}
                                    className="input w-full"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">SSH User</label>
                                <input
                                    type="text"
                                    name="sshUser"
                                    defaultValue={initialDeployment?.sshUser || 'ubuntu'}
                                    className="input w-full"
                                />
                            </div>

                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium mb-1">Deploy Directory (Remote)</label>
                                <input
                                    type="text"
                                    name="deployDir"
                                    defaultValue={initialDeployment?.deployDir}
                                    className="input w-full"
                                    placeholder="/home/ubuntu/apps/my-app/build"
                                />
                                <p className="text-[10px] text-muted-foreground mt-1">
                                    The target folder on the host. In "Worker-as-Source" mode, workers sync directly to this path.
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">Application URL</label>
                                <input
                                    type="text"
                                    name="appUrl"
                                    defaultValue={initialDeployment?.appUrl}
                                    className="input w-full"
                                    placeholder="https://app.example.com"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">Rebuild Services</label>
                                <input
                                    type="text"
                                    name="deployServices"
                                    defaultValue={initialDeployment?.metadata?.deployServices || ''}
                                    className="input w-full"
                                    placeholder="e.g. portal,worker"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                        <div className="flex gap-4">
                            <button
                                type="submit"
                                disabled={loading}
                                className="btn btn-primary"
                            >
                                {loading ? 'Saving...' : (isEditing ? 'Update Project' : 'Create Project')}
                            </button>
                            <Link href="/settings/projects" className="btn btn-secondary">
                                Cancel
                            </Link>
                        </div>
                        {isEditing && (
                            <button
                                type="button"
                                onClick={handleDelete}
                                disabled={deleting}
                                className="btn btn-danger"
                            >
                                {deleting ? 'Deleting...' : 'Delete Project'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Right Column: Methodology & Context */}
                <div className="space-y-6">
                    <div className="card bg-swarm-surface/40 border-swarm-green/20">
                        <h3 className="font-semibold text-swarm-green mb-2 flex items-center gap-2 text-sm">
                            <span className="w-2 h-2 rounded-full bg-swarm-green"></span>
                            Worker-as-Source Mode
                        </h3>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                            System detected direct mount access. Workers will bypass remote Git pulls and sync their
                            validated sidecar worktrees directly to production folders. This ensures what you
                            tested is exactly what you deploy.
                        </p>
                    </div>

                    <div className="card bg-swarm-surface/30 border-swarm-blue/20">
                        <h3 className="font-semibold text-swarm-blue mb-2 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-swarm-blue"></span>
                            How Swarm Works
                        </h3>
                        <div className="text-sm text-muted-foreground space-y-3">
                            <p>
                                <strong>1. Plan:</strong> The Planner agent discusses requirements and creates an <code className="text-foreground text-[10px]">implementation_plan.md</code>.
                            </p>
                            <p>
                                <strong>2. Edit:</strong> The Coder agent edits source files in an isolated worktree within <code className="text-foreground text-[10px]">{initialProject?.projectFolder || '/apps/your-project'}</code>.
                            </p>
                            <p>
                                <strong>3. Sync:</strong> The Swarm syncs code **directly** from the worker's worktree to the <strong>Deploy Directory</strong> on the host.
                            </p>
                            <p>
                                <strong>4. Rebuild:</strong> The Server runs <code className="text-foreground text-[10px]">docker compose up --build</code> in the target folder.
                            </p>
                        </div>
                    </div>

                    <div className="card bg-swarm-surface/30 border-yellow-500/20">
                        <h3 className="font-semibold text-yellow-500 mb-2 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                            Path Mapping Guide
                        </h3>
                        <div className="text-xs text-muted-foreground space-y-3">
                            <div className="bg-background/50 rounded p-2 border border-border/30">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">If your project is at:</p>
                                <code className="text-foreground opacity-75 text-[10px]">/home/ubuntu/apps/my-project</code>
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2 mb-1">You enter:</p>
                                <code className="text-swarm-blue text-[11px]">/apps/my-project</code>
                            </div>
                            <p>
                                <strong>Container Path:</strong> Where the worker accesses code<br />
                                <span className="font-mono text-foreground opacity-75 text-[10px]">/apps/my-project</span>
                            </p>
                            <p>
                                <strong>Host Path:</strong> Server filesystem location<br />
                                <span className="font-mono text-foreground opacity-75 text-[10px]">$WORKSPACE_ROOT/my-project</span>
                            </p>
                            <p>
                                <strong>Worktrees:</strong> Isolated folders per task<br />
                                <span className="font-mono text-foreground opacity-75 text-[10px]">/apps/my-project/worktrees/task-123</span>
                            </p>
                            <div className="border-t border-border/30 pt-2 mt-2">
                                <p className="text-[9px] opacity-75">
                                    Volume mount: <code>$WORKSPACE_ROOT</code> → <code>/apps</code>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </form>
    );
}
