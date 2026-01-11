'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Prompt {
    id: string;
    name: string;
    version: number;
    content: string;
    isActive: boolean;
}

export default function PromptsSettingsPage() {
    const [prompts, setPrompts] = useState<Prompt[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchPrompts();
    }, []);

    async function fetchPrompts() {
        try {
            const res = await fetch('/api/system/prompts');
            if (!res.ok) throw new Error('Failed to fetch prompts');
            const data = await res.json();
            setPrompts(data.prompts);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }

    function startEditing(prompt: Prompt) {
        setEditing(prompt.name);
        setEditContent(prompt.content);
    }

    async function savePrompt(name: string) {
        setSaving(true);
        try {
            const res = await fetch('/api/system/prompts', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, content: editContent }),
            });

            if (!res.ok) throw new Error('Failed to save prompt');

            setEditing(null);
            fetchPrompts(); // Refresh
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setSaving(false);
        }
    }

    async function resetPrompt(name: string) {
        if (!confirm('Are you sure you want to reset this prompt to its default system version? Current changes will be lost.')) return;

        setSaving(true);
        try {
            const res = await fetch('/api/system/prompts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, action: 'reset' }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to reset prompt');
            }

            const data = await res.json();
            setEditContent(data.content); // Update editor with reset content

            // Optionally close editor or keep open with new content
            // setEditing(null); 
            // fetchPrompts();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setSaving(false);
        }
    }

    // Group prompts by name, show only active
    const activePrompts = prompts.filter(p => p.isActive);

    if (loading) {
        return (
            <main className="min-h-screen p-8">
                <div className="max-w-4xl mx-auto animate-pulse">
                    <div className="h-8 bg-swarm-surface rounded w-1/4 mb-6"></div>
                    <div className="space-y-4">
                        {[1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="h-32 bg-swarm-surface rounded"></div>
                        ))}
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen p-8">
            <div className="max-w-4xl mx-auto">
                <div className="flex items-center gap-4 mb-6">
                    <Link href="/" className="text-muted-foreground hover:text-foreground">
                        Dashboard
                    </Link>
                    <span className="text-muted-foreground">/</span>
                    <h1 className="text-2xl font-bold">Prompts</h1>
                </div>

                <p className="text-swarm-muted mb-6">
                    System prompts define the behavior of each agent role.
                </p>

                {error && (
                    <div className="card border-swarm-red/50 mb-4">
                        <p className="text-swarm-red">{error}</p>
                    </div>
                )}

                <div className="space-y-4">
                    {(() => {
                        const DESCRIPTIONS: Record<string, string> = {
                            'planner': 'Analyzes the request, researches the codebase, and creates a step-by-step implementation plan.',
                            'coder': 'Implements the approved plan by writing, modifying, or deleting files.',
                            'reviewer': "Evaluates the coder's work for correctness, quality, and security before merging.",
                            'deployer': 'Orchestrates deployments, analyzes logs, and identifies infrastructure or code errors for recovery.',
                            'claude-identity': 'The core personality and system constraints that define how the AI identifies itself. Note: This prompt is specifically for Claude Code and is not used by Gemini agents.'
                        };
                        const ORDER = ['planner', 'coder', 'reviewer', 'deployer', 'claude-identity'];

                        return activePrompts
                            .sort((a, b) => {
                                const idxA = ORDER.indexOf(a.name.toLowerCase());
                                const idxB = ORDER.indexOf(b.name.toLowerCase());
                                return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
                            })
                            .map(prompt => (
                                <div key={prompt.id} className="card">
                                    <div className="flex items-start justify-between mb-2">
                                        <div>
                                            <h2 className="font-medium capitalize">{prompt.name}</h2>
                                            <p className="text-sm text-swarm-muted mt-0.5">
                                                {DESCRIPTIONS[prompt.name.toLowerCase()] || 'System prompt for this role.'}
                                            </p>
                                        </div>
                                        {editing !== prompt.name && (
                                            <button
                                                onClick={() => startEditing(prompt)}
                                                className="text-swarm-blue text-sm hover:underline"
                                            >
                                                Edit
                                            </button>
                                        )}
                                    </div>

                                    {editing === prompt.name ? (
                                        <div className="space-y-3">
                                            <textarea
                                                value={editContent}
                                                onChange={e => setEditContent(e.target.value)}
                                                className="input w-full h-64 font-mono text-sm"
                                            />
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => savePrompt(prompt.name)}
                                                    disabled={saving}
                                                    className="btn btn-primary text-sm"
                                                >
                                                    {saving ? 'Saving...' : 'Save Changes'}
                                                </button>
                                                <button
                                                    onClick={() => setEditing(null)}
                                                    className="btn btn-secondary text-sm"
                                                >
                                                    Cancel
                                                </button>
                                                <div className="flex-1"></div>
                                                <button
                                                    onClick={() => resetPrompt(prompt.name)}
                                                    className="btn btn-ghost text-xs text-swarm-red hover:underline self-center"
                                                    disabled={saving}
                                                >
                                                    Reset to Default
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <pre className="text-xs text-swarm-muted bg-swarm-surface p-3 rounded overflow-x-auto max-h-32 overflow-y-auto mt-4">
                                            {prompt.content.slice(0, 500)}
                                            {prompt.content.length > 500 && '...'}
                                        </pre>
                                    )}
                                </div>
                            ));
                    })()}
                </div>
            </div>
        </main>
    );
}
