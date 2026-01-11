'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, MessageSquare, GitBranch, Menu } from 'lucide-react';
import clsx from 'clsx';

interface MobileNavProps {
    onMenuClick: () => void;
    isOpen?: boolean;
}

export function MobileNav({ onMenuClick, isOpen }: MobileNavProps) {
    const pathname = usePathname();

    const isActive = (path: string) => {
        if (path === '/') return pathname === '/';
        return pathname?.startsWith(path);
    };

    return (
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border px-6 py-3 flex items-center justify-between safe-area-inset-bottom">
            <NavLink href="/" icon={LayoutDashboard} label="Home" active={isActive('/')} />
            <NavLink href="/submit" icon={MessageSquare} label="Chat" active={isActive('/submit')} />
            <NavLink href="/workflows" icon={GitBranch} label="Tasks" active={isActive('/workflows')} />

            <button
                onClick={onMenuClick}
                className={clsx(
                    "flex flex-col items-center gap-1 transition-colors",
                    isOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
            >
                <Menu className="h-5 w-5" />
                <span className="text-[10px] font-medium uppercase tracking-wider">Menu</span>
            </button>
        </div>
    );
}

function NavLink({ href, icon: Icon, label, active }: any) {
    return (
        <Link
            href={href}
            className={clsx(
                "flex flex-col items-center gap-1 transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
        >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
        </Link>
    );
}
