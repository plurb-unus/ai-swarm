'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, GitBranch, MessageSquare, Settings, ChevronDown, FolderGit2, Terminal, Cpu, Shield, Clock, BookOpen, CheckSquare, Fingerprint } from 'lucide-react';
import { useState, useEffect } from 'react';
import clsx from 'clsx';

interface SidebarProps {
    isOpen?: boolean;
    onClose?: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
    const pathname = usePathname();
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);


    // Close sidebar when route changes on mobile
    useEffect(() => {
        if (isOpen && onClose) {
            onClose();
        }
    }, [pathname]);

    // Expand sections if we are on a relevant page
    useEffect(() => {
        if (pathname?.startsWith('/settings')) {
            setIsSettingsOpen(true);
        }
    }, [pathname]);

    const isActive = (path: string) => pathname === path || pathname?.startsWith(path + '/');

    return (
        <>
            {/* Mobile Overlay */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
                    onClick={onClose}
                />
            )}

            <aside className={clsx(
                "fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-card flex flex-col h-screen transition-transform duration-300 ease-in-out md:sticky md:top-0 md:translate-x-0",
                !isOpen && "-translate-x-full"
            )}>
                {/* Logo area */}
                <div className="p-6 border-b border-border">
                    <Link href="/" className="flex items-center gap-2 font-semibold text-lg hover:opacity-90 transition-opacity">
                        <Image
                            src="/logo.svg"
                            alt="AI Swarm Logo"
                            width={24}
                            height={24}
                            className="rounded-sm"
                        />
                        <span>AI Swarm</span>
                    </Link>
                </div>

                {/* Navigation */}
                <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
                    <NavItem href="/" icon={LayoutDashboard} label="Dashboard" active={pathname === '/'} />
                    <NavItem href="/workflows" icon={GitBranch} label="Workflows" active={isActive('/workflows')} />
                    <NavItem href="/submit" icon={MessageSquare} label="Chat & Plan" active={isActive('/submit')} />

                    {/* External Tools */}
                    <div className="pt-4 mt-4 border-t border-border">
                        <a
                            href="/temporal/namespaces/ai-swarm"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors"
                        >
                            <Clock className="h-4 w-4" />
                            <span>Temporal</span>
                        </a>
                    </div>

                    {/* Settings Section */}
                    <div className="mt-1">
                        <button
                            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                            className={clsx(
                                "w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors",
                                isActive('/settings') ? "text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <Settings className="h-4 w-4" />
                                <span>Settings</span>
                            </div>
                            <ChevronDown className={clsx("h-4 w-4 transition-transform", isSettingsOpen && "rotate-180")} />
                        </button>

                        {isSettingsOpen && (
                            <div className="mt-1 ml-4 pl-3 border-l border-border space-y-1">
                                <NavItem href="/settings/projects" icon={FolderGit2} label="Projects" active={isActive('/settings/projects')} size="sm" />
                                <NavItem href="/settings/prompts" icon={Terminal} label="Prompts" active={isActive('/settings/prompts')} size="sm" />
                                <NavItem href="/settings/llm" icon={Cpu} label="LLM Config" active={isActive('/settings/llm')} size="sm" />
                                <NavItem href="/settings/system" icon={Shield} label="System" active={isActive('/settings/system')} size="sm" />
                                <NavItem href="/settings/security" icon={Fingerprint} label="Security" active={isActive('/settings/security')} size="sm" />
                            </div>
                        )}
                    </div>

                    {/* Quick Start & Documentation */}
                    <div className="pt-4 mt-4 border-t border-border space-y-1">
                        <NavItem href="/quick-start" icon={CheckSquare} label="Quick Start" active={isActive('/quick-start')} />
                        <a
                            href="https://ai-swarm.dev/docs"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors"
                        >
                            <BookOpen className="h-4 w-4" />
                            <span>Documentation</span>
                        </a>
                    </div>
                </nav>


            </aside>
        </>
    );
}

function NavItem({ href, icon: Icon, label, active, size = 'md' }: any) {
    return (
        <Link
            href={href}
            className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
                size === 'sm' ? "text-xs" : "text-sm font-medium",
                active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
        >
            <Icon className={clsx(size === 'sm' ? "h-3.5 w-3.5" : "h-4 w-4")} />
            {label}
        </Link>
    );
}
