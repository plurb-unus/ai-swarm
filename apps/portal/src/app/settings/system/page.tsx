'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, Save, RefreshCw } from 'lucide-react';

interface WorkersSummary {
    configuredCount: number;
    summary: {
        total: number;
        healthy: number;
        degraded: number;
        offline: number;
    };
}

interface SystemConfig {
    claude_auth_mode?: 'oauth' | 'zai';
}

export default function SystemSettingsPage() {
    const [workers, setWorkers] = useState<WorkersSummary | null>(null);
    const [config, setConfig] = useState<SystemConfig>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    // SCM per-provider tokens
    const [scmTokenAzure, setScmTokenAzure] = useState('');
    const [scmTokenGithub, setScmTokenGithub] = useState('');
    const [scmTokenGitlab, setScmTokenGitlab] = useState('');
    const [showScmTokenAzure, setShowScmTokenAzure] = useState(false);
    const [showScmTokenGithub, setShowScmTokenGithub] = useState(false);
    const [showScmTokenGitlab, setShowScmTokenGitlab] = useState(false);
    const [workspaceRoot, setWorkspaceRoot] = useState('');
    const [defaultProjectDir, setDefaultProjectDir] = useState('');
    const [logLevel, setLogLevel] = useState('info');
    const [workerCount, setWorkerCount] = useState('4');
    const [chatMaxAgeDays, setChatMaxAgeDays] = useState('90');

    // Email config
    const [emailProvider, setEmailProvider] = useState('resend');
    const [emailApiKey, setEmailApiKey] = useState('');
    const [showEmailApiKey, setShowEmailApiKey] = useState(false);
    const [emailFrom, setEmailFrom] = useState('');
    const [emailTo, setEmailTo] = useState('');

    // Test credentials
    const [testEmail, setTestEmail] = useState('');
    const [testPassword, setTestPassword] = useState('');
    const [showTestPassword, setShowTestPassword] = useState(false);

    useEffect(() => {
        async function fetchData() {
            try {
                const [workersRes, configRes] = await Promise.all([
                    fetch('/api/system/workers'),
                    fetch('/api/system/config'),
                ]);
                if (workersRes.ok) {
                    const data = await workersRes.json();
                    setWorkers(data);
                }
                if (configRes.ok) {
                    const data = await configRes.json();
                    setConfig(data);

                    // Map config keys to state
                    if (data.scm_token_azure_devops) setScmTokenAzure(data.scm_token_azure_devops);
                    if (data.scm_token_github) setScmTokenGithub(data.scm_token_github);
                    if (data.scm_token_gitlab) setScmTokenGitlab(data.scm_token_gitlab);
                    if (data.workspace_root) setWorkspaceRoot(data.workspace_root);
                    if (data.default_project_dir) setDefaultProjectDir(data.default_project_dir);
                    if (data.log_level) setLogLevel(data.log_level);
                    if (data.worker_count) setWorkerCount(data.worker_count);
                    if (data.chat_max_age_days) setChatMaxAgeDays(data.chat_max_age_days);
                    if (data.email_provider) setEmailProvider(data.email_provider);
                    if (data.email_api_key) setEmailApiKey(data.email_api_key);
                    if (data.email_from) setEmailFrom(data.email_from);
                    if (data.email_to) setEmailTo(data.email_to);
                    if (data.test_user_email) setTestEmail(data.test_user_email);
                    if (data.test_user_password) setTestPassword(data.test_user_password);
                }
            } catch (err) {
                console.error('Failed to fetch data:', err);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    const claudeAuthMode = config.claude_auth_mode || 'oauth';

    async function saveConfig(key: string, value: string) {
        setSaving(key);
        try {
            const res = await fetch('/api/system/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, value }),
            });
            if (res.ok) {
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
            }
        } catch (err) {
            console.error(`Failed to save ${key}:`, err);
        } finally {
            setSaving(null);
        }
    }

    async function handleRestart() {
        if (!confirm('Are you sure you want to restart the AI Swarm? The portal will be unavailable for a few moments.')) return;
        setSaving('restart');
        try {
            const res = await fetch('/api/system/restart', { method: 'POST' });
            if (res.ok) {
                alert('Restart initiated. Please refresh the page in a few moments.');
            }
        } catch (err) {
            alert('Failed to initiate restart: ' + err);
        } finally {
            setSaving(null);
        }
    }

    return (
        <main className="min-h-screen p-8">
            <div className="max-w-4xl mx-auto">
                <div className="flex items-center gap-4 mb-6">
                    <Link href="/" className="text-muted-foreground hover:text-foreground">
                        Dashboard
                    </Link>
                    <span className="text-muted-foreground">/</span>
                    <h1 className="text-2xl font-bold">System Settings</h1>
                </div>

                {saved && (
                    <div className="card border-green-500/50 mb-4">
                        <p className="text-green-400 text-sm">Configuration saved successfully.</p>
                    </div>
                )}

                <div className="space-y-6">
                    {/* Workers & Environment Status */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="card">
                            <h2 className="font-medium mb-2">Workers</h2>
                            {loading ? (
                                <div className="animate-pulse h-8 bg-muted rounded w-1/2"></div>
                            ) : (
                                <div className="space-y-2">
                                    <p className="text-2xl font-bold">{workers?.configuredCount || 0}</p>
                                    <p className="text-sm text-muted-foreground">Configured workers</p>
                                    {workers && (
                                        <div className="flex gap-4 text-sm mt-2">
                                            <span className="text-green-400">{workers.summary.healthy} healthy</span>
                                            <span className="text-red-400">{workers.summary.offline} offline</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="card">
                            <h2 className="font-medium mb-2">Environment</h2>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Temporal</span>
                                    <span className="text-green-400">Connected</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Redis</span>
                                    <span className="text-green-400">Connected</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">PostgreSQL</span>
                                    <span className="text-green-400">Connected</span>
                                </div>
                            </div>
                        </div>
                    </div>


                    {/* Per-Provider SCM Tokens */}
                    <div className="card">
                        <h2 className="font-medium mb-4">Source Control Tokens</h2>
                        <p className="text-xs text-muted-foreground mb-4">
                            Default tokens for each SCM provider. Used when a project does not have its own token configured.
                        </p>
                        <div className="space-y-4">
                            {/* Azure DevOps */}
                            <div>
                                <label className="block text-sm font-medium mb-2">Azure DevOps</label>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <input
                                            type={showScmTokenAzure ? 'text' : 'password'}
                                            value={scmTokenAzure}
                                            onChange={(e) => setScmTokenAzure(e.target.value)}
                                            placeholder="Personal Access Token (PAT)"
                                            className="input w-full pr-10"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowScmTokenAzure(!showScmTokenAzure)}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            {showScmTokenAzure ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => saveConfig('scm_token_azure_devops', scmTokenAzure)}
                                        disabled={saving === 'scm_token_azure_devops'}
                                        className="btn btn-primary"
                                    >
                                        {saving === 'scm_token_azure_devops' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            {/* GitHub */}
                            <div>
                                <label className="block text-sm font-medium mb-2">GitHub</label>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <input
                                            type={showScmTokenGithub ? 'text' : 'password'}
                                            value={scmTokenGithub}
                                            onChange={(e) => setScmTokenGithub(e.target.value)}
                                            placeholder="Personal Access Token (classic or fine-grained)"
                                            className="input w-full pr-10"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowScmTokenGithub(!showScmTokenGithub)}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            {showScmTokenGithub ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => saveConfig('scm_token_github', scmTokenGithub)}
                                        disabled={saving === 'scm_token_github'}
                                        className="btn btn-primary"
                                    >
                                        {saving === 'scm_token_github' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            {/* GitLab */}
                            <div>
                                <label className="block text-sm font-medium mb-2">GitLab</label>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <input
                                            type={showScmTokenGitlab ? 'text' : 'password'}
                                            value={scmTokenGitlab}
                                            onChange={(e) => setScmTokenGitlab(e.target.value)}
                                            placeholder="Personal Access Token or Project Token"
                                            className="input w-full pr-10"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowScmTokenGitlab(!showScmTokenGitlab)}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            {showScmTokenGitlab ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => saveConfig('scm_token_gitlab', scmTokenGitlab)}
                                        disabled={saving === 'scm_token_gitlab'}
                                        className="btn btn-primary"
                                    >
                                        {saving === 'scm_token_gitlab' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-4">
                            Token hierarchy: Per-Project Token (highest) → Provider Token (above) → ENV SCM_TOKEN
                        </p>
                    </div>

                    {/* Workspace Config */}
                    <div className="card">
                        <h2 className="font-medium mb-4">Workspace</h2>
                        <div className="space-y-4">

                            <div>
                                <label className="block text-sm font-medium mb-2">Default Project Directory</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={defaultProjectDir}
                                        onChange={(e) => setDefaultProjectDir(e.target.value)}
                                        placeholder="/apps/my-project"
                                        className="input flex-1"
                                    />
                                    <button
                                        onClick={() => saveConfig('default_project_dir', defaultProjectDir)}
                                        disabled={saving === 'default_project_dir'}
                                        className="btn btn-primary"
                                    >
                                        {saving === 'default_project_dir' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Workspace Root</label>
                                <p className="text-xs text-muted-foreground mb-2">
                                    Container path where all projects are mounted (e.g., /apps). Each project's base_path is relative to this root.
                                </p>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={workspaceRoot}
                                        onChange={(e) => setWorkspaceRoot(e.target.value)}
                                        placeholder="/apps"
                                        className="input flex-1"
                                    />
                                    <button
                                        onClick={() => saveConfig('workspace_root', workspaceRoot)}
                                        disabled={saving === 'workspace_root'}
                                        className="btn btn-primary"
                                    >
                                        {saving === 'workspace_root' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Email Notifications */}
                    <div className="card">
                        <h2 className="font-medium mb-4">Email Notifications</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">Provider</label>
                                <select
                                    value={emailProvider}
                                    onChange={(e) => {
                                        setEmailProvider(e.target.value);
                                        saveConfig('email_provider', e.target.value);
                                    }}
                                    className="input w-full"
                                >
                                    <option value="resend">Resend</option>
                                    <option value="sendgrid">SendGrid</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">API Key</label>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <input
                                            type={showEmailApiKey ? 'text' : 'password'}
                                            value={emailApiKey}
                                            onChange={(e) => setEmailApiKey(e.target.value)}
                                            placeholder="Email API key"
                                            className="input w-full pr-10"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowEmailApiKey(!showEmailApiKey)}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            {showEmailApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => saveConfig('email_api_key', emailApiKey)}
                                        disabled={saving === 'email_api_key'}
                                        className="btn btn-primary"
                                    >
                                        {saving === 'email_api_key' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">From Address</label>
                                <div className="flex gap-2">
                                    <input
                                        type="email"
                                        value={emailFrom}
                                        onChange={(e) => setEmailFrom(e.target.value)}
                                        placeholder="noreply@example.com"
                                        className="input flex-1"
                                    />
                                    <button
                                        onClick={() => saveConfig('email_from', emailFrom)}
                                        disabled={saving === 'email_from'}
                                        className="btn btn-primary"
                                    >
                                        {saving === 'email_from' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Notification Recipients</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={emailTo}
                                        onChange={(e) => setEmailTo(e.target.value)}
                                        placeholder="admin@example.com, team@example.com"
                                        className="input flex-1"
                                    />
                                    <button
                                        onClick={() => saveConfig('email_to', emailTo)}
                                        disabled={saving === 'email_to'}
                                        className="btn btn-primary"
                                    >
                                        {saving === 'email_to' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Playwright Test Credentials */}
                    <div className="card">
                        <h2 className="font-medium mb-4">Playwright Test Credentials</h2>
                        <p className="text-sm text-muted-foreground mb-4">
                            Credentials used for automated browser testing of authenticated pages.
                        </p>
                        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded p-4 mb-6">
                            <p className="text-xs text-yellow-500/80 leading-relaxed">
                                <strong>Note:</strong> These credentials are <strong>global</strong> for the entire swarm. They are required if you want Playwright to verify projects that require a login (e.g., verifying builds on a staging server).
                            </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">Test Email</label>
                                <div className="flex gap-2">
                                    <input
                                        type="email"
                                        value={testEmail}
                                        onChange={(e) => setTestEmail(e.target.value)}
                                        placeholder="test@example.com"
                                        className="input flex-1"
                                    />
                                    <button
                                        onClick={() => saveConfig('test_user_email', testEmail)}
                                        disabled={saving === 'test_user_email'}
                                        className="btn btn-primary"
                                    >
                                        {saving === 'test_user_email' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Test Password</label>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <input
                                            type={showTestPassword ? 'text' : 'password'}
                                            value={testPassword}
                                            onChange={(e) => setTestPassword(e.target.value)}
                                            placeholder="Test password"
                                            className="input w-full pr-10"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowTestPassword(!showTestPassword)}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            {showTestPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => saveConfig('test_user_password', testPassword)}
                                        disabled={saving === 'test_user_password'}
                                        className="btn btn-primary"
                                    >
                                        {saving === 'test_user_password' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* System Settings */}
                    <div className="card">
                        <h2 className="font-medium mb-4">System</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">Worker Count</label>
                                <input
                                    type="number"
                                    value={workerCount}
                                    disabled
                                    className="input w-full opacity-60 cursor-not-allowed"
                                />
                                <p className="text-[10px] text-muted-foreground mt-1">
                                    Run <code className="bg-zinc-800 px-1 rounded">./scale-workers.sh [1-8]</code> to change worker count.
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Log Level</label>
                                <select
                                    value={logLevel}
                                    onChange={(e) => {
                                        setLogLevel(e.target.value);
                                        saveConfig('log_level', e.target.value);
                                    }}
                                    className="input w-full"
                                >
                                    <option value="debug">Debug</option>
                                    <option value="info">Info</option>
                                    <option value="warn">Warn</option>
                                    <option value="error">Error</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">Chat Retention (Days)</label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        min="1"
                                        max="365"
                                        value={chatMaxAgeDays}
                                        onChange={(e) => setChatMaxAgeDays(e.target.value)}
                                        className="input flex-1"
                                    />
                                    <button
                                        onClick={() => saveConfig('chat_max_age_days', chatMaxAgeDays)}
                                        disabled={saving === 'chat_max_age_days'}
                                        className="btn btn-primary"
                                    >
                                        {saving === 'chat_max_age_days' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    </button>
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-1">Chats older than this will be expired (TTL)</p>
                            </div>
                        </div>

                        <div className="mt-6 pt-6 border-t border-border/50">
                            <h3 className="text-sm font-medium mb-2">Swarm Control</h3>
                            <button
                                onClick={handleRestart}
                                disabled={saving === 'restart'}
                                className="btn btn-secondary flex items-center gap-2 text-swarm-red hover:bg-swarm-red/10"
                            >
                                {saving === 'restart' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                Restart AI Swarm
                            </button>
                            <p className="text-[10px] text-muted-foreground mt-2">
                                Restarts all AI Swarm containers (Portal, Workers, Sidecars).
                                Infrastructure like Temporal and Database will remain online.
                            </p>
                        </div>
                    </div>


                </div>
            </div>
        </main>
    );
}
