'use client';

import { useState, useEffect } from 'react';
import { X, Rocket } from 'lucide-react';
import Link from 'next/link';

export function OnboardingBanner() {
    const [isVisible, setIsVisible] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Check if onboarding has been completed
        const checkOnboardingStatus = async () => {
            try {
                const res = await fetch('/api/system/config');
                if (res.ok) {
                    const data = await res.json();
                    const onboardingComplete = data.onboarding_complete === 'true';
                    setIsVisible(!onboardingComplete);
                }
            } catch (err) {
                // If we can't check, don't show the banner
                console.error('Failed to check onboarding status:', err);
            } finally {
                setIsLoading(false);
            }
        };

        checkOnboardingStatus();
    }, []);

    const handleDismiss = async () => {
        try {
            await fetch('/api/system/onboarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ complete: true }),
            });
            setIsVisible(false);
        } catch (err) {
            console.error('Failed to dismiss onboarding:', err);
        }
    };

    if (isLoading || !isVisible) {
        return null;
    }

    return (
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-3 relative">
            <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Rocket className="h-5 w-5 flex-shrink-0" />
                    <p className="text-sm font-medium">
                        <span className="font-bold">Welcome to AI Swarm!</span>
                        {' '}Before you start, make sure to{' '}
                        <Link href="/settings/projects" className="underline hover:no-underline font-semibold">
                            configure a Project
                        </Link>
                        {' '}and set up your{' '}
                        <Link href="/settings/system" className="underline hover:no-underline font-semibold">
                            LLM Authentication
                        </Link>.
                    </p>
                </div>
                <button
                    onClick={handleDismiss}
                    className="flex-shrink-0 p-1 rounded hover:bg-white/20 transition-colors"
                    aria-label="Dismiss"
                >
                    <X className="h-5 w-5" />
                </button>
            </div>
        </div>
    );
}
