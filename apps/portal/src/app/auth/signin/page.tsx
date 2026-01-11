'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import Image from 'next/image';
import { Fingerprint, Loader2 } from 'lucide-react';
import { startAuthentication } from '@simplewebauthn/browser';

/**
 * AI Swarm v3.0.0 - Sovereign Auth Sign In Page
 * 
 * Primary: Passkey authentication (TouchID, FaceID, Windows Hello)
 * Fallback: CLI-generated magic link for bootstrap/recovery
 */

function SignInContent() {
    const searchParams = useSearchParams();
    const error = searchParams.get('error');
    const callbackUrl = searchParams.get('callbackUrl') || '/';

    const [isLoading, setIsLoading] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);

    const handlePasskeyLogin = async () => {
        setIsLoading(true);
        setAuthError(null);

        try {
            // Step 1: Get authentication options from server
            const optionsRes = await fetch('/api/auth/passkey/login/options');
            if (!optionsRes.ok) {
                throw new Error('Failed to get authentication options');
            }
            const { options, challengeId } = await optionsRes.json();

            // Check if options are valid (passkeys exist)
            if (!options || !options.challenge) {
                setAuthError('No passkeys registered. Use a magic link to sign in first: ./scripts/sovereign-login.sh [email]');
                setIsLoading(false);
                return;
            }

            // Step 2: Trigger WebAuthn authentication (browser prompt)
            // Note: v11+ API requires { optionsJSON: options } format
            const authResponse = await startAuthentication({ optionsJSON: options });

            // Step 3: Verify with server
            const verifyRes = await fetch('/api/auth/passkey/login/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    response: authResponse,
                    challengeId,
                }),
            });

            if (!verifyRes.ok) {
                const data = await verifyRes.json();
                throw new Error(data.error || 'Authentication failed');
            }

            const { userId } = await verifyRes.json();

            // Step 4: Create NextAuth session
            const result = await signIn('sovereign', {
                type: 'passkey',
                credentialId: userId, // We pass userId here, validated on server
                challengeId,
                callbackUrl,
                redirect: true,
            });

            if (result?.error) {
                throw new Error(result.error);
            }

        } catch (err) {
            console.error('Passkey login error:', err);
            if (err instanceof Error) {
                if (err.name === 'NotAllowedError') {
                    setAuthError('Authentication was cancelled or timed out.');
                } else if (err.message.includes('No authenticator')) {
                    setAuthError('No passkeys registered. Use a magic link to sign in first.');
                } else {
                    setAuthError(err.message);
                }
            } else {
                setAuthError('An unexpected error occurred');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const displayError = error || authError;

    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="card max-w-md w-full p-8 text-center">
                <div className="mb-6">
                    <div className="flex items-center justify-center gap-2">
                        <Image
                            src="/logo.svg"
                            alt="AI Swarm Logo"
                            width={32}
                            height={32}
                            className="rounded-sm"
                        />
                        <h1 className="text-2xl font-semibold tracking-tight">AI Swarm</h1>
                    </div>
                    <p className="text-muted-foreground mt-2">Sign in to access the portal</p>
                </div>

                {displayError && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-md">
                        <p className="text-red-400 text-sm">
                            {displayError === 'AccessDenied'
                                ? 'Access denied.'
                                : displayError === 'InvalidToken'
                                    ? 'Invalid or expired magic link.'
                                    : displayError === 'MissingToken'
                                        ? 'No token provided.'
                                        : displayError}
                        </p>
                    </div>
                )}

                <button
                    onClick={handlePasskeyLogin}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                        <Fingerprint className="w-5 h-5" />
                    )}
                    {isLoading ? 'Authenticating...' : 'Sign in with Passkey'}
                </button>
            </div>
        </div>
    );
}

export default function SignInPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
            <SignInContent />
        </Suspense>
    );
}
