'use client';

/**
 * AI Swarm v3.0.0 - Mermaid Diagram Component
 * Renders Mermaid diagrams with dark theme support.
 */

import { useEffect, useRef, useState } from 'react';

interface MermaidDiagramProps {
    chart: string;
    className?: string;
}

export function MermaidDiagram({ chart, className = '' }: MermaidDiagramProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [svg, setSvg] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const renderDiagram = async () => {
            try {
                // Dynamically import mermaid to avoid SSR issues
                const mermaid = (await import('mermaid')).default;

                mermaid.initialize({
                    startOnLoad: false,
                    theme: 'dark',
                    themeVariables: {
                        primaryColor: '#3b82f6',
                        primaryTextColor: '#fff',
                        primaryBorderColor: '#60a5fa',
                        lineColor: '#6b7280',
                        secondaryColor: '#1f2937',
                        tertiaryColor: '#374151',
                        background: '#111827',
                        mainBkg: '#1f2937',
                        nodeBkg: '#1f2937',
                        nodeBorder: '#3b82f6',
                        clusterBkg: '#374151',
                        clusterBorder: '#4b5563',
                        defaultLinkColor: '#6b7280',
                        titleColor: '#f9fafb',
                        edgeLabelBackground: '#1f2937',
                    },
                    flowchart: {
                        htmlLabels: true,
                        curve: 'basis',
                    },
                });

                const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
                const { svg: renderedSvg } = await mermaid.render(id, chart);
                setSvg(renderedSvg);
                setError(null);
            } catch (err) {
                console.error('Mermaid render error:', err);
                setError('Failed to render diagram');
            }
        };

        renderDiagram();
    }, [chart]);

    if (error) {
        return (
            <div className={`bg-red-900/20 border border-red-500 rounded-lg p-4 ${className}`}>
                <p className="text-red-400 text-sm">{error}</p>
                <pre className="text-gray-400 text-xs mt-2 overflow-x-auto">{chart}</pre>
            </div>
        );
    }

    if (!svg) {
        return (
            <div className={`bg-gray-800 rounded-lg p-8 flex items-center justify-center ${className}`}>
                <div className="animate-pulse text-gray-400">Loading diagram...</div>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className={`bg-gray-800/50 rounded-lg p-4 overflow-x-auto ${className}`}
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
}
