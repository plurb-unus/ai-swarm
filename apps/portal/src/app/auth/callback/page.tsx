'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * AI Swarm v3.0.0 - Auth Callback Page
 * 
 * Handles the redirect after magic link verification.
 * Automatically triggers NextAuth session creation.
 */

function CallbackContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState('Initializing...');
    const hasRun = useRef(false);

    useEffect(() => {
        // Prevent double execution in React StrictMode
        if (hasRun.current) return;
        hasRun.current = true;

        const userId = searchParams.get('userId');
        const email = searchParams.get('email');

        console.log('Callback params:', { userId, email });

        if (!userId || !email) {
            setError('Invalid callback parameters');
            return;
        }

        setStatus('Creating session...');

        // Create NextAuth session using the verified magic link
        // Using redirect: true so NextAuth handles session creation and redirect properly
        signIn('sovereign', {
            type: 'magic-link',
            token: 'verified', // Token already verified by /api/auth/verify
            credentialId: userId,
            callbackUrl: '/',
            redirect: true,
        });
    }, [searchParams]);

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="card max-w-md w-full p-8 text-center">
                    <div className="text-red-400 mb-4">Authentication Error</div>
                    <p className="text-muted-foreground text-sm">{error}</p>
                    <button
                        onClick={() => window.location.href = '/auth/signin'}
                        className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="card max-w-md w-full p-8 text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
                <p className="text-muted-foreground">{status}</p>
            </div>
        </div>
    );
}

export default function AuthCallbackPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
            <CallbackContent />
        </Suspense>
    );
}
