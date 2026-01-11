'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { Fingerprint, Plus, Trash2, Loader2, Shield, AlertTriangle } from 'lucide-react';
import { startRegistration } from '@simplewebauthn/browser';

/**
 * AI Swarm v3.0.0 - Security Settings Page
 * 
 * Manage passkeys (WebAuthn authenticators) for your account.
 */

interface Authenticator {
    credential_id: string;
    name: string;
    created_at: string;
    last_used_at: string | null;
    credential_device_type: string;
}

export default function SecuritySettingsPage() {
    const { data: session } = useSession();
    const [authenticators, setAuthenticators] = useState<Authenticator[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRegistering, setIsRegistering] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Fetch authenticators on mount
    useEffect(() => {
        fetchAuthenticators();
    }, []);

    const fetchAuthenticators = async () => {
        try {
            const res = await fetch('/api/auth/passkey/list');
            if (res.ok) {
                const data = await res.json();
                setAuthenticators(data.authenticators || []);
            }
        } catch (err) {
            console.error('Failed to fetch authenticators:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRegisterPasskey = async () => {
        setIsRegistering(true);
        setError(null);
        setSuccess(null);

        try {
            // Step 1: Get registration options
            const optionsRes = await fetch('/api/auth/passkey/register/options', {
                method: 'POST',
            });
            if (!optionsRes.ok) {
                throw new Error('Failed to get registration options');
            }
            const { options, challengeId } = await optionsRes.json();

            // Validate options before calling WebAuthn
            if (!options || !options.challenge) {
                throw new Error('Failed to get valid registration options. Please try again.');
            }
            // Step 2: Trigger WebAuthn registration (browser prompt)
            // Note: v11+ API requires { optionsJSON: options } format
            const registrationResponse = await startRegistration({ optionsJSON: options });

            // Step 3: Verify with server
            const verifyRes = await fetch('/api/auth/passkey/register/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    response: registrationResponse,
                    challengeId,
                    deviceName: 'My Device', // Could prompt user for name
                }),
            });

            if (!verifyRes.ok) {
                const data = await verifyRes.json();
                throw new Error(data.error || 'Registration failed');
            }

            setSuccess('Passkey registered successfully!');
            fetchAuthenticators(); // Refresh list

        } catch (err) {
            console.error('Passkey registration error:', err);
            if (err instanceof Error) {
                if (err.name === 'NotAllowedError') {
                    setError('Registration was cancelled or timed out.');
                } else if (err.name === 'InvalidStateError') {
                    setError('This device is already registered.');
                } else {
                    setError(err.message);
                }
            } else {
                setError('An unexpected error occurred');
            }
        } finally {
            setIsRegistering(false);
        }
    };

    const handleDeletePasskey = async (credentialId: string) => {
        if (!confirm('Are you sure you want to delete this passkey? You will not be able to use it to sign in.')) {
            return;
        }

        try {
            const res = await fetch('/api/auth/passkey/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credentialId }),
            });

            if (!res.ok) {
                throw new Error('Failed to delete passkey');
            }

            setSuccess('Passkey deleted successfully');
            fetchAuthenticators();

        } catch (err) {
            console.error('Delete passkey error:', err);
            setError(err instanceof Error ? err.message : 'Failed to delete passkey');
        }
    };

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return 'Never';
        return new Date(dateStr).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    return (
        <div className="max-w-4xl mx-auto p-6">
            <div className="flex items-center gap-3 mb-6">
                <Shield className="h-8 w-8 text-primary" />
                <div>
                    <h1 className="text-2xl font-semibold">Security Settings</h1>
                    <p className="text-muted-foreground">Manage your passkeys and authentication</p>
                </div>
            </div>

            {/* Status Messages */}
            {error && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-md flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-red-400" />
                    <p className="text-red-400 text-sm">{error}</p>
                </div>
            )}
            {success && (
                <div className="mb-6 p-4 bg-green-500/10 border border-green-500/50 rounded-md">
                    <p className="text-green-400 text-sm">{success}</p>
                </div>
            )}

            {/* Passkeys Section */}
            <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Fingerprint className="h-5 w-5 text-primary" />
                        <h2 className="text-lg font-medium">Registered Passkeys</h2>
                    </div>
                    <button
                        onClick={handleRegisterPasskey}
                        disabled={isRegistering}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                        {isRegistering ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Plus className="h-4 w-4" />
                        )}
                        {isRegistering ? 'Registering...' : 'Register New Device'}
                    </button>
                </div>

                <p className="text-sm text-muted-foreground mb-4">
                    Passkeys allow you to sign in securely using your device&apos;s biometrics (TouchID, FaceID, Windows Hello)
                    or security key. No passwords required.
                </p>

                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : authenticators.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                        <Fingerprint className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>No passkeys registered yet.</p>
                        <p className="text-sm mt-1">Click &quot;Register New Device&quot; to add your first passkey.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {authenticators.map((auth) => (
                            <div
                                key={auth.credential_id}
                                className="flex items-center justify-between p-4 bg-muted/50 rounded-md"
                            >
                                <div className="flex items-center gap-3">
                                    <Fingerprint className="h-5 w-5 text-muted-foreground" />
                                    <div>
                                        <p className="font-medium">{auth.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            Added {formatDate(auth.created_at)}
                                            {auth.last_used_at && ` • Last used ${formatDate(auth.last_used_at)}`}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDeletePasskey(auth.credential_id)}
                                    className="p-2 text-muted-foreground hover:text-red-400 transition-colors"
                                    title="Delete passkey"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Account Info */}
            <div className="card p-6 mt-6">
                <h2 className="text-lg font-medium mb-4">Account Information</h2>
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Email</span>
                        <span>{session?.user?.email || 'Not available'}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Name</span>
                        <span>{session?.user?.name || 'Not set'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
