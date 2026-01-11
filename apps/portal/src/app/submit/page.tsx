'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
}

interface ConversationSummary {
    tag: string;
    title: string;
    summary: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
}

interface Conversation {
    tag: string;
    title: string;
    messages: Message[];
    planReady: boolean;
}

interface Project {
    id: string;
    name: string;
}

export default function ChatPage() {
    const router = useRouter();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);



    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<string>('');
    const [conversations, setConversations] = useState<ConversationSummary[]>([]);
    const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'; // Reset height
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`; // Set new height (max 200px)
        }
    }, [input]);

    // Load conversations and projects on mount
    useEffect(() => {
        loadConversations();
        loadProjects();
    }, []);

    // Scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [currentConversation?.messages]);

    async function loadProjects() {
        try {
            const res = await fetch('/api/projects');
            const data = await res.json();
            if (data.projects?.length > 0) {
                setProjects(data.projects);
                // Select first project by default
                if (!selectedProject) {
                    setSelectedProject(data.projects[0].id);
                }
            }
        } catch (err) {
            console.error('Failed to load projects:', err);
        }
    }

    async function loadConversations() {
        try {
            const res = await fetch('/api/chat');
            const data = await res.json();
            setConversations(data.conversations || []);
        } catch (err) {
            console.error('Failed to load conversations:', err);
        }
    }

    async function selectConversation(tag: string) {
        try {
            setLoading(true);
            const res = await fetch(`/api/chat?tag=${encodeURIComponent(tag)}`);
            const data = await res.json();
            setCurrentConversation(data);
            setError(null);
        } catch (err) {
            setError('Failed to load conversation');
        } finally {
            setLoading(false);
        }
    }

    async function startNewConversation() {
        if (!input.trim()) return;

        try {
            setLoading(true);
            setError(null);

            // Create new conversation
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'new', message: input }),
            });
            const newConv = await res.json();

            setCurrentConversation({
                tag: newConv.tag,
                title: newConv.title,
                messages: [],
                planReady: false,
            });

            // Send first message to Planner
            await sendMessage(newConv.tag, input);

            // Refresh conversation list
            await loadConversations();
            setInput('');
        } catch (err) {
            setError('Failed to start conversation');
        } finally {
            setLoading(false);
        }
    }

    async function sendMessage(tag: string, message: string) {
        try {
            setLoading(true);
            setError(null);

            // Add user message optimistically
            setCurrentConversation((prev) => prev ? {
                ...prev,
                messages: [...prev.messages, {
                    role: 'user' as const,
                    content: message,
                    timestamp: new Date().toISOString(),
                }],
            } : null);

            // Send to Planner
            const res = await fetch('/api/chat/planner', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tag, message, projectId: selectedProject }),
            });

            if (!res.ok) {
                // FIX: Added more descriptive error handling for API failures
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || `Server error: ${res.status}`);
            }

            const data = await res.json();
            setCurrentConversation(data.conversation);
        } catch (err) {
            // FIX: Specific message for potential timeouts
            const msg = err instanceof Error ? err.message : 'Failed to send message';
            setError(msg.includes('504') || msg.includes('timeout')
                ? 'Planner is taking too long to respond. The task might still be processing, please refresh in a moment.'
                : msg);
        } finally {
            setLoading(false);
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!input.trim() || loading) return;

        if (currentConversation) {
            await sendMessage(currentConversation.tag, input);
            setInput('');
        } else {
            await startNewConversation();
        }
    }

    /**
     * Send a forcing prompt to generate the plan as JSON.
     * This recovers from cases where the Planner responds with prose instead of JSON.
     */
    async function generatePlan() {
        if (!currentConversation) return;

        const forcingPrompt = `Based on our conversation, output the implementation plan as pure JSON now.

IMPORTANT: Respond with ONLY the JSON object, no explanation or text before/after. Format:
{
    "proposedChanges": [{ "path": "...", "action": "modify|create|delete", "description": "..." }],
    "verificationPlan": "How to test",
    "estimatedEffort": "X hours"
}`;

        await sendMessage(currentConversation.tag, forcingPrompt);
    }

    // Helper to extract JSON from content - simple approach
    function extractPlanJSON(content: string): any | null {
        try {
            const trimmed = content.trim();

            // Extract from code fences if present
            const fenceMatch = trimmed.match(/```(?:\w+)?\s*([\s\S]*?)```/);
            const jsonContent = fenceMatch ? fenceMatch[1].trim() : trimmed;

            // Just try to parse it directly
            const parsed = JSON.parse(jsonContent);

            // Verify it has the required fields
            if (parsed.proposedChanges && parsed.verificationPlan) {
                return parsed;
            }
            return null;
        } catch {
            return null;
        }
    }

    async function createTask() {
        if (!currentConversation) return;

        // Find the plan JSON in messages (handles markdown code fences and explanatory text)
        const planMessage = currentConversation.messages
            .filter(m => m.role === 'assistant')
            .reverse()
            .find(m => extractPlanJSON(m.content) !== null);

        if (!planMessage) {
            setError('No plan found in conversation');
            return;
        }

        try {
            const plan = extractPlanJSON(planMessage.content);
            if (!plan) {
                setError('Invalid plan format');
                return;
            }

            // Create task via workflows API
            const res = await fetch('/api/workflows', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task: {
                        id: `task-${Date.now()}`,
                        title: currentConversation.title,
                        context: currentConversation.messages
                            .filter(m => m.role === 'user')
                            .map(m => m.content)
                            .join('\n'),
                        plan,
                        projectId: selectedProject,
                        createdAt: new Date().toISOString(),
                    },
                    skipApproval: true,
                    notifyOnComplete: true,
                }),
            });

            if (!res.ok) {
                throw new Error('Failed to create task');
            }

            const data = await res.json();
            router.push(`/workflows/${data.workflowId}`);
        } catch (err) {
            setError('Failed to create task');
        }
    }

    function newConversation() {
        setCurrentConversation(null);
        setInput('');
        setError(null);
    }

    async function deleteChat(tag: string) {
        if (!confirm('Are you sure you want to delete this conversation?')) return;

        try {
            setLoading(true);
            const res = await fetch(`/api/chat?tag=${encodeURIComponent(tag)}`, {
                method: 'DELETE',
            });

            if (!res.ok) throw new Error('Failed to delete conversation');

            // Reset UI
            if (currentConversation?.tag === tag) {
                newConversation();
            }

            // Refresh list
            await loadConversations();
        } catch (err) {
            setError('Failed to delete conversation');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex flex-col h-[calc(100vh-120px)] md:h-[calc(100vh-200px)]">
            {/* Header with conversation selector */}
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-3">
                <h1 className="text-xl md:text-2xl font-bold">Chat with Planner</h1>
                <div className="flex flex-wrap items-center gap-2">
                    {/* Project Selector v3.0.0 */}
                    {projects.length > 0 && (
                        <select
                            value={selectedProject}
                            onChange={(e) => setSelectedProject(e.target.value)}
                            className="px-2 py-1.5 md:px-3 md:py-2 bg-card border border-border rounded-md text-sm focus:border-primary focus:outline-none"
                        >
                            {projects.map((project) => (
                                <option key={project.id} value={project.id}>
                                    {project.name}
                                </option>
                            ))}
                        </select>
                    )}
                    <select
                        value={currentConversation?.tag || ''}
                        onChange={(e) => e.target.value ? selectConversation(e.target.value) : newConversation()}
                        className="px-2 py-1.5 md:px-3 md:py-2 bg-card border border-border rounded-md text-sm focus:border-primary focus:outline-none max-w-[150px] md:max-w-none"
                    >
                        <option value="">New Conversation</option>
                        {conversations.map((conv) => (
                            <option key={conv.tag} value={conv.tag}>
                                {conv.title}
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={newConversation}
                        className="btn btn-ghost text-xs md:text-sm px-2 h-8"
                    >
                        + New
                    </button>
                    {currentConversation && (
                        <button
                            onClick={() => deleteChat(currentConversation.tag)}
                            className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"
                            title="Delete Chat"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {/* Error display */}
            {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-md">
                    <p className="text-red-400 text-sm">{error}</p>
                </div>
            )}

            {/* Chat messages */}
            <div className="flex-1 overflow-y-auto card p-4 space-y-4">
                {!currentConversation && (
                    <div className="text-center text-swarm-muted py-8">
                        <p className="text-lg mb-2">Start a conversation with Planner</p>
                        <p className="text-sm">Describe your task and I&apos;ll ask clarifying questions until we have a solid plan.</p>
                    </div>
                )}

                {currentConversation?.messages.map((msg, idx) => (
                    <div
                        key={idx}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div
                            className={`max-w-[85%] md:max-w-[80%] rounded-lg px-3 py-2 md:px-4 md:py-3 ${msg.role === 'user'
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-card border border-border'
                                }`}
                        >
                            <div className="text-xs opacity-70 mb-1">
                                {msg.role === 'user' ? 'You' : 'Planner'}
                            </div>
                            <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                        </div>
                    </div>
                ))}

                {loading && (
                    <div className="flex justify-start">
                        <div className="bg-swarm-card border border-swarm-border rounded-lg px-4 py-3">
                            <div className="text-xs opacity-70 mb-1">Planner</div>
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-swarm-blue rounded-full animate-bounce" />
                                <div className="w-2 h-2 bg-swarm-blue rounded-full animate-bounce [animation-delay:0.1s]" />
                                <div className="w-2 h-2 bg-swarm-blue rounded-full animate-bounce [animation-delay:0.2s]" />
                            </div>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="mt-4">
                <form onSubmit={handleSubmit} className="flex gap-3 items-end">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSubmit(e as any);
                            }
                        }}
                        placeholder={currentConversation ? "Reply to Planner..." : "Describe your task..."}
                        disabled={loading}
                        rows={1}
                        className="flex-1 px-4 py-3 bg-swarm-bg border border-swarm-border rounded-md focus:border-swarm-blue focus:outline-none disabled:opacity-50 resize-none overflow-y-auto min-h-[46px]"
                    />
                    <button
                        type="submit"
                        disabled={loading || !input.trim()}
                        className="btn btn-primary px-6"
                    >
                        {loading ? '...' : 'Send'}
                    </button>
                </form>

                {/* Action buttons */}
                <div className="flex flex-col items-end mt-3 gap-2">
                    <div className="flex gap-3">
                        {/* Generate Plan button - shows when 2+ messages */}
                        {currentConversation &&
                            currentConversation.messages.length >= 2 && (
                                <button
                                    onClick={generatePlan}
                                    disabled={loading}
                                    className="btn btn-ghost border border-swarm-blue text-swarm-blue hover:bg-swarm-blue/10"
                                >
                                    Generate Plan
                                </button>
                            )}
                        {/* Submit Task button - shows when there's at least one assistant response */}
                        {currentConversation &&
                            currentConversation.messages.some(m => m.role === 'assistant') && (
                                <button
                                    onClick={createTask}
                                    disabled={loading}
                                    className="btn btn-primary"
                                >
                                    Submit Task
                                </button>
                            )}
                    </div>
                    {currentConversation &&
                        currentConversation.messages.some(m => m.role === 'assistant') && (
                            <p className="text-xs text-muted-foreground">
                                Submit only after a plan with JSON has been generated.
                            </p>
                        )}
                </div>
            </div>
        </div>
    );
}

