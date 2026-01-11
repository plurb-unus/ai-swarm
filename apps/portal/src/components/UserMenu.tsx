'use client';

import { useSession, signOut } from 'next-auth/react';
import { useState } from 'react';

export function UserMenu() {
    const { data: session } = useSession();
    const [isOpen, setIsOpen] = useState(false);

    if (!session?.user) {
        return null;
    }

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 text-swarm-muted hover:text-swarm-text transition-colors"
            >
                {session.user.image ? (
                    <img
                        src={session.user.image}
                        alt={session.user.name || 'User'}
                        className="w-8 h-8 rounded-full"
                    />
                ) : (
                    <div className="w-8 h-8 rounded-full bg-swarm-blue flex items-center justify-center text-white text-sm font-medium">
                        {session.user.name?.[0] || session.user.email?.[0] || '?'}
                    </div>
                )}
                <span className="hidden sm:inline text-sm">
                    {session.user.name || session.user.email}
                </span>
            </button>

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 w-48 bg-swarm-card border border-swarm-border rounded-md shadow-lg z-20">
                        <div className="p-3 border-b border-swarm-border">
                            <p className="text-sm font-medium truncate">
                                {session.user.name}
                            </p>
                            <p className="text-xs text-swarm-muted truncate">
                                {session.user.email}
                            </p>
                        </div>
                        <button
                            onClick={() => signOut({ callbackUrl: '/auth/signin' })}
                            className="w-full text-left px-3 py-2 text-sm text-swarm-muted hover:text-swarm-text hover:bg-swarm-bg transition-colors"
                        >
                            Sign out
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
