'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function ErrorContent() {
    const searchParams = useSearchParams();
    const error = searchParams.get('error');

    const errorMessages: Record<string, string> = {
        AccessDenied: 'Your email address is not authorized to access this portal.',
        Configuration: 'There is a problem with the server configuration.',
        Verification: 'The sign-in link is no longer valid.',
        Default: 'An error occurred during authentication.',
    };

    const message = errorMessages[error || 'Default'] || errorMessages.Default;

    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="card max-w-md w-full p-8 text-center">
                <div className="mb-6">
                    <span className="text-4xl">⚠️</span>
                    <h1 className="text-2xl font-bold mt-4 text-red-400">
                        Authentication Error
                    </h1>
                </div>

                <p className="text-swarm-muted mb-6">{message}</p>

                <a href="/auth/signin" className="btn btn-primary">
                    Try Again
                </a>

                <p className="mt-6 text-xs text-swarm-muted">
                    If you believe this is an error, contact the administrator.
                </p>
            </div>
        </div>
    );
}

export default function AuthErrorPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
            <ErrorContent />
        </Suspense>
    );
}
