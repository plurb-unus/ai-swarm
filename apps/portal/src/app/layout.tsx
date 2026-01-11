import './globals.css';
import type { Metadata } from 'next';
import { Providers } from '@/components/Providers';
import { PortalLayout } from '@/components/PortalLayout';
import { Inter } from 'next/font/google';

const inter = Inter({
    subsets: ['latin'],
    variable: '--font-inter',
    display: 'swap',
});

export const metadata: Metadata = {
    title: 'AI Swarm - Orchestration Portal',
    description: 'Real-time monitoring and control for your AI agent swarm',
    metadataBase: new URL('https://dev.ai-swarm.dev'),
    icons: {
        icon: '/favicon.png',
        apple: '/apple-icon.png',
    },
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" suppressHydrationWarning className={inter.variable}>
            <body className="min-h-screen bg-background font-sans text-foreground tracking-tight antialiased">
                <Providers>
                    <PortalLayout>
                        {children}
                    </PortalLayout>
                </Providers>
            </body>
        </html>
    );
}
