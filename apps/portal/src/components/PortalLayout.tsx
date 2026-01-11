'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { MobileNav } from '@/components/MobileNav';
import { OnboardingBanner } from '@/components/OnboardingBanner';

interface PortalLayoutProps {
    children: React.ReactNode;
}

export function PortalLayout({ children }: PortalLayoutProps) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    return (
        <div className="flex min-h-screen">
            {/* Sidebar Navigation */}
            <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 transition-colors">
                <OnboardingBanner />
                <Header />
                <main className="flex-1 p-4 md:p-6 overflow-y-auto w-full max-w-7xl mx-auto pb-24 md:pb-6">
                    {children}
                </main>
            </div>

            {/* Mobile Navigation Bar */}
            <MobileNav
                onMenuClick={() => setIsSidebarOpen(!isSidebarOpen)}
                isOpen={isSidebarOpen}
            />
        </div>
    );
}
