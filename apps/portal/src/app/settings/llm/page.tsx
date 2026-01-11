'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';

interface LLMRole {
    role: string;
    provider: 'gemini' | 'claude';
    description: string;
}

const roleDescriptions: Record<string, string> = {
    portal_planner: 'Powers the chat interface on the Submit page',
    planner: 'Creates implementation plans and orchestrates workflow tasks',
    coder: 'Implements code changes and creates PRs',
    reviewer: 'Reviews code for quality and consistency. Also used for .aicontext updates.',
    deployer: 'Orchestrates deployments, troubleshoots failures, and visual verification.',
};

type ClaudeAuthMode = 'oauth' | 'zai';

export default function LLMSettingsPage() {
    const [roles, setRoles] = useState<LLMRole[]>([]);
    const [claudeAuthMode, setClaudeAuthMode] = useState<ClaudeAuthMode>('oauth');
    const [zaiApiKey, setZaiApiKey] = useState('');
    const [deployerBlacklist, setDeployerBlacklist] = useState('');
    const [pendingRoles, setPendingRoles] = useState<LLMRole[]>([]);
    const [pendingClaudeAuthMode, setPendingClaudeAuthMode] = useState<ClaudeAuthMode>('oauth');
    const [pendingZaiApiKey, setPendingZaiApiKey] = useState('');
    const [pendingDeployerBlacklist, setPendingDeployerBlacklist] = useState('');
    const [showZaiKey, setShowZaiKey] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [checkingAuth, setCheckingAuth] = useState(false);
    const [authReport, setAuthReport] = useState<any>(null);

    useEffect(() => {
        async function loadConfig() {
            try {
                const res = await fetch('/api/system/config');
                if (res.ok) {
                    const data = await res.json();
                    if (data.claude_auth_mode) {
                        setClaudeAuthMode(data.claude_auth_mode as ClaudeAuthMode);
                        setPendingClaudeAuthMode(data.claude_auth_mode as ClaudeAuthMode);
                    }
                    if (data.llm_roles) {
                        const roleList: LLMRole[] = Object.entries(data.llm_roles).map(([role, provider]) => ({
                            role,
                            provider: provider as 'gemini' | 'claude',
                            description: roleDescriptions[role] || '',
                        }));
                        const order = ['portal_planner', 'planner', 'coder', 'reviewer', 'deployer'];
                        roleList.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
                        setRoles(roleList);
                        setPendingRoles(roleList);
                    }
                    if (data.z_ai_api_key) {
                        setZaiApiKey(data.z_ai_api_key);
                        setPendingZaiApiKey(data.z_ai_api_key);
                    }
                    if (data.deployer_blacklist) {
                        setDeployerBlacklist(data.deployer_blacklist);
                        setPendingDeployerBlacklist(data.deployer_blacklist);
                    }
                }
            } catch (err) {
                console.error('Failed to load config:', err);
            } finally {
                setLoading(false);
            }
        }
        loadConfig();
    }, []);

    async function saveAllChanges() {
        setSaving(true);
        try {
            // Save each role
            for (const role of pendingRoles) {
                const original = roles.find(r => r.role === role.role);
                if (original?.provider !== role.provider) {
                    await fetch('/api/system/config', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key: 'llm_role', role: role.role, provider: role.provider }),
                    });
                }
            }

            // Save auth mode and Z.ai key
            if (pendingClaudeAuthMode !== claudeAuthMode) {
                await fetch('/api/system/config', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'claude_auth_mode', value: pendingClaudeAuthMode }),
                });
            }

            if (pendingZaiApiKey !== zaiApiKey) {
                await fetch('/api/system/config', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'z_ai_api_key', value: pendingZaiApiKey }),
                });
            }

            // Save deployer blacklist
            if (pendingDeployerBlacklist !== deployerBlacklist) {
                await fetch('/api/system/config', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'deployer_blacklist', value: pendingDeployerBlacklist }),
                });
            }

            setRoles(pendingRoles);
            setClaudeAuthMode(pendingClaudeAuthMode);
            setZaiApiKey(pendingZaiApiKey);
            setDeployerBlacklist(pendingDeployerBlacklist);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (err) {
            console.error('Failed to save config:', err);
            alert('Failed to save configuration. Check console for details.');
        } finally {
            setSaving(false);
        }
    }

    async function checkSwarmAuth() {
        setCheckingAuth(true);
        try {
            const res = await fetch('/api/system/auth-check', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                setAuthReport(data);
            }
        } catch (err) {
            console.error('Failed to check swarm auth:', err);
        } finally {
            setCheckingAuth(false);
        }
    }

    return (
        <main className="min-h-screen p-8">
            <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="text-muted-foreground hover:text-foreground">
                            Dashboard
                        </Link>
                        <span className="text-muted-foreground">/</span>
                        <h1 className="text-2xl font-bold">LLM Configuration</h1>
                    </div>
                    <button
                        onClick={saveAllChanges}
                        disabled={saving}
                        className="btn btn-primary"
                    >
                        {saving ? 'Saving...' : 'Save Configuration'}
                    </button>
                </div>

                {saved && (
                    <div className="card border-swarm-green/50 mb-4">
                        <p className="text-swarm-green text-sm">
                            Configuration saved. Changes apply on next workflow.
                        </p>
                    </div>
                )}

                {/* 1. Role Configuration */}
                <div className="card mb-6">
                    <h2 className="font-medium mb-4">Role Configuration</h2>
                    {loading ? (
                        <div className="space-y-3">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="animate-pulse h-16 bg-swarm-surface rounded"></div>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {pendingRoles.map(item => (
                                <div key={item.role} className="flex items-center justify-between p-4 bg-swarm-surface rounded-lg">
                                    <div>
                                        <h3 className="font-medium capitalize">{item.role}</h3>
                                        <p className="text-sm text-swarm-muted">{item.description}</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setPendingRoles(prev => prev.map(r => r.role === item.role ? { ...r, provider: 'gemini' } : r))}
                                            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${item.provider === 'gemini'
                                                ? 'bg-swarm-blue text-white'
                                                : 'bg-swarm-bg text-swarm-muted hover:text-swarm-text hover:bg-swarm-border'
                                                }`}
                                        >
                                            Gemini
                                        </button>
                                        <button
                                            onClick={() => setPendingRoles(prev => prev.map(r => r.role === item.role ? { ...r, provider: 'claude' } : r))}
                                            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${item.provider === 'claude'
                                                ? 'bg-swarm-purple text-white'
                                                : 'bg-swarm-bg text-swarm-muted hover:text-swarm-text hover:bg-swarm-border'
                                                }`}
                                        >
                                            Claude
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 2. About LLM Providers */}
                <div className="card mb-6">
                    <h2 className="font-medium mb-2">About LLM Providers</h2>
                    <div className="text-sm text-swarm-muted space-y-2">
                        <p>
                            <strong className="text-swarm-text">Gemini</strong> - Google&apos;s models via Gemini CLI.
                            Requires worker login via <code className="bg-swarm-bg px-1 rounded">./auth-gemini.sh</code>
                        </p>
                        <p>
                            <strong className="text-swarm-text">Claude</strong> - Anthropic&apos;s models.
                            Supports Pro/Max OAuth login (<code className="bg-swarm-bg px-1 rounded">./auth-claude.sh</code>) or Z.ai API key.
                        </p>
                    </div>
                </div>

                {/* 3. Claude Authentication */}
                <div className="card mb-6">
                    <h2 className="font-medium mb-4">Claude Authentication</h2>
                    {loading ? (
                        <div className="animate-pulse h-10 bg-swarm-surface rounded w-1/2"></div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex gap-4">
                                <button
                                    onClick={() => setPendingClaudeAuthMode('oauth')}
                                    className={`flex-1 p-4 rounded-lg border-2 transition-colors text-left ${pendingClaudeAuthMode === 'oauth'
                                        ? 'border-swarm-purple bg-swarm-purple/10'
                                        : 'border-swarm-border hover:border-swarm-muted'
                                        }`}
                                >
                                    <div className="font-medium mb-1">Pro/Max Subscription (OAuth)</div>
                                    <div className="text-sm text-swarm-muted">
                                        Requires worker login via <code className="bg-swarm-bg px-1 rounded">./auth-claude.sh</code>
                                    </div>
                                </button>
                                <button
                                    onClick={() => setPendingClaudeAuthMode('zai')}
                                    className={`flex-1 p-4 rounded-lg border-2 transition-colors text-left ${pendingClaudeAuthMode === 'zai'
                                        ? 'border-primary bg-primary/10'
                                        : 'border-border hover:border-muted-foreground'
                                        }`}
                                >
                                    <div className="font-medium mb-1">Z.ai API Key</div>
                                    <div className="text-sm text-muted-foreground">
                                        Requires Z.ai API key (configure below)
                                    </div>
                                </button>
                            </div>

                            {/* Restart Warning */}
                            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                <p className="text-xs text-amber-400">
                                    <strong>Note:</strong> Changing Claude authentication mode requires a <strong>full container restart</strong> to take effect.
                                    After saving, run: <code className="bg-swarm-bg px-1 rounded">docker compose up -d --force-recreate portal worker</code>
                                </p>
                            </div>

                            {pendingClaudeAuthMode === 'zai' && (
                                <div className="mt-4 p-4 rounded-lg border border-border bg-card/50">
                                    <label className="block text-sm font-medium mb-2">Z.ai API Key</label>
                                    <div className="relative">
                                        <input
                                            type={showZaiKey ? 'text' : 'password'}
                                            value={pendingZaiApiKey}
                                            onChange={(e) => setPendingZaiApiKey(e.target.value)}
                                            placeholder="Enter your Z.ai API key"
                                            className="input w-full pr-10"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowZaiKey(!showZaiKey)}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            {showZaiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>


                {/* 5. Deployer Container Blacklist (v3.0.0) */}
                <div className="card mb-6">
                    <h2 className="font-medium mb-2">Deployer Container Blacklist</h2>
                    <p className="text-sm text-swarm-muted mb-4">
                        Containers the LLM Deployer is prohibited from stopping, restarting, or modifying.
                        Separate container names with commas.
                    </p>
                    {loading ? (
                        <div className="animate-pulse h-20 bg-swarm-surface rounded"></div>
                    ) : (
                        <textarea
                            value={pendingDeployerBlacklist}
                            onChange={(e) => setPendingDeployerBlacklist(e.target.value)}
                            placeholder="temporal-server, postgres, redis, traefik, ai-swarm-portal, ..."
                            className="input w-full h-24 resize-y"
                            rows={3}
                        />
                    )}
                    <p className="text-xs text-swarm-muted mt-2">
                        Default: temporal-server, postgres, redis, traefik, portainer, ai-swarm-portal, ai-swarm-worker-1 through 8, ai-swarm-playwright, ai-swarm-builder
                    </p>
                </div>

                {/* 5. Authentication Status */}
                <div className="card">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="font-medium">Authentication Status</h2>
                    </div>

                    <div className="space-y-4">
                        {/* Z.ai Explanation */}
                        {claudeAuthMode === 'zai' && (
                            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                                <p className="text-xs text-blue-400">
                                    <strong>Using Z.ai API Key:</strong> Claude &quot;Requires Login&quot; messages can be ignored.
                                    Z.ai authentication bypasses OAuth entirely - workers are authenticated via the API key.
                                </p>
                            </div>
                        )}
                        {authReport ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Portal Status */}
                                <div className="p-4 rounded-lg border border-border bg-swarm-bg/50">
                                    <h3 className="text-sm font-semibold mb-2">Portal (Local)</h3>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-muted-foreground">Claude:</span>
                                            <span className={authReport.portal.claude.authenticated ? 'text-emerald-400' : 'text-amber-400'}>
                                                {authReport.portal.claude.message}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-muted-foreground">Gemini:</span>
                                            <span className={authReport.portal.gemini.authenticated ? 'text-emerald-400' : 'text-amber-400'}>
                                                {authReport.portal.gemini.message}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Worker Swarm Status */}
                                {authReport.workers.map((w: any) => (
                                    <div key={w.id} className="p-4 rounded-lg border border-border bg-card">
                                        <h3 className="text-sm font-semibold mb-2 capitalize">{w.id.replace(/-/g, ' ')}</h3>
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-muted-foreground">Claude:</span>
                                                <span className={w.claude.authenticated ? 'text-emerald-400' : 'text-amber-400'}>
                                                    {w.claude.message}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-muted-foreground">Gemini:</span>
                                                <span className={w.gemini.authenticated ? 'text-emerald-400' : 'text-amber-400'}>
                                                    {w.gemini.message}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {authReport.workers.length === 0 && (
                                    <p className="text-xs text-muted-foreground col-span-2 py-4 text-center">
                                        No active workers detected. Start your swarm to see status.
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className="p-8 text-center border-2 border-dashed border-border rounded-lg">
                                <p className="text-sm text-muted-foreground mb-4">
                                    Perform a real-time check to verify CLI sessions on all workers.
                                </p>
                                <button
                                    onClick={checkSwarmAuth}
                                    disabled={checkingAuth}
                                    className="btn btn-secondary"
                                >
                                    {checkingAuth ? 'Checking...' : 'Check Swarm Auth Status'}
                                </button>
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground mt-4">
                            Manual verification executes CLI commands on each worker to ensure sessions are still valid.
                        </p>
                    </div>
                </div>

            </div>
        </main>
    );
}
