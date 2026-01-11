'use client';

import { usePathname } from 'next/navigation';
import { UserMenu } from '@/components/UserMenu';
import { SwarmStatus } from '@/components/SwarmStatus';



export function Header() {
    const pathname = usePathname();

    // Hide header on auth pages (login, error)
    if (pathname?.startsWith('/auth')) {
        return null;
    }

    // Simple breadcrumb logic
    const getTitle = () => {
        if (pathname === '/') return 'Dashboard';
        const parts = pathname?.split('/').filter(Boolean) || [];
        return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' / ') || 'Dashboard';
    };

    return (
        <header className="h-16 border-b border-border bg-card/50 backdrop-blur-sm px-4 md:px-6 flex items-center justify-between sticky top-0 z-10 transition-colors">
            <h1 className="text-lg md:text-xl font-semibold text-foreground truncate max-w-[120px] md:max-w-none">
                {getTitle()}
            </h1>

            <div className="flex items-center gap-2 md:gap-4">
                <div className="scale-90 md:scale-100 origin-right">
                    <SwarmStatus />
                </div>
                <div className="h-6 w-px bg-border hidden sm:block" />
                <UserMenu />
            </div>
        </header>
    );
}
