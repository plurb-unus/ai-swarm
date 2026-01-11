'use client';

/**
 * AI Swarm v3.0.0 - Markdown Renderer Component
 * Renders Markdown content with Tailwind styling and GFM support.
 * Standardised to match application theme tokens.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
    content: string;
    className?: string;
}

const components: Components = {
    // Headings
    h1: ({ children }) => (
        <h1 className="text-3xl font-bold text-foreground mb-6 mt-8 first:mt-0 border-b border-border pb-3 tracking-tight">
            {children}
        </h1>
    ),
    h2: ({ children }) => (
        <h2 className="text-2xl font-semibold text-foreground mb-4 mt-8 first:mt-0 tracking-tight">
            {children}
        </h2>
    ),
    h3: ({ children }) => (
        <h3 className="text-xl font-semibold text-foreground/90 mb-3 mt-6 tracking-tight">
            {children}
        </h3>
    ),
    h4: ({ children }) => (
        <h4 className="text-lg font-medium text-foreground/80 mb-2 mt-4">
            {children}
        </h4>
    ),

    // Paragraphs
    p: ({ children }) => (
        <p className="text-muted-foreground mb-4 leading-relaxed font-sans">{children}</p>
    ),

    // Lists
    ul: ({ children }) => (
        <ul className="list-disc list-inside text-muted-foreground mb-4 space-y-2 ml-4 font-sans">
            {children}
        </ul>
    ),
    ol: ({ children }) => (
        <ol className="list-decimal list-inside text-muted-foreground mb-4 space-y-2 ml-4 font-sans">
            {children}
        </ol>
    ),
    li: ({ children }) => <li className="text-muted-foreground">{children}</li>,

    // Links
    a: ({ href, children }) => {
        const isExternal = href?.startsWith('http');
        return (
            <a
                href={href}
                className="text-primary hover:text-primary/80 underline decoration-primary/30 underline-offset-4 transition-colors"
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
            >
                {children}
            </a>
        );
    },

    // Code blocks
    code: ({ className, children }) => {
        const isBlock = className?.includes('language-');
        if (isBlock) {
            return (
                <code className="block bg-muted/50 border border-border text-foreground p-4 rounded-lg overflow-x-auto text-sm font-mono mb-4">
                    {children}
                </code>
            );
        }
        return (
            <code className="bg-muted text-primary px-1.5 py-0.5 rounded text-sm font-mono whitespace-nowrap">
                {children}
            </code>
        );
    },
    pre: ({ children }) => (
        <pre className="bg-muted/50 rounded-lg overflow-x-auto mb-4 border border-border">
            {children}
        </pre>
    ),

    // Blockquotes (styled as info boxes)
    blockquote: ({ children }) => (
        <blockquote className="border-l-4 border-primary bg-primary/5 pl-4 py-2 mb-4 text-muted-foreground italic font-sans">
            {children}
        </blockquote>
    ),

    // Tables
    table: ({ children }) => (
        <div className="overflow-x-auto mb-6 border border-border rounded-lg">
            <table className="min-w-full divide-y divide-border font-sans">
                {children}
            </table>
        </div>
    ),
    thead: ({ children }) => (
        <thead className="bg-muted/50">{children}</thead>
    ),
    tbody: ({ children }) => (
        <tbody className="divide-y divide-border">{children}</tbody>
    ),
    tr: ({ children }) => <tr className="hover:bg-muted/30 transition-colors">{children}</tr>,
    th: ({ children }) => (
        <th className="px-4 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
            {children}
        </th>
    ),
    td: ({ children }) => (
        <td className="px-4 py-3 text-sm text-muted-foreground">{children}</td>
    ),

    // Horizontal rule
    hr: () => <hr className="border-border my-8" />,

    // Strong and emphasis
    strong: ({ children }) => (
        <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
};

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
    return (
        <div className={`prose prose-invert max-w-none font-sans ${className}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {content}
            </ReactMarkdown>
        </div>
    );
}
