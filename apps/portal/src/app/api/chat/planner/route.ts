import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getConversation, addMessage } from '@/lib/chat-storage';

// Planner system prompt
const PLANNER_SYSTEM = `You are Planner, the Lead Architect for AI Swarm.

Your job is to have a conversation with the user to understand their task requirements.
Ask clarifying questions until you have enough information to create a solid implementation plan.

CRITICAL RULES:
1. When gathering information: Ask specific, helpful questions. Be conversational.
2. When ready to create a plan: Output ONLY the raw JSON object below. NO prose, NO explanation, NO "Here is the plan" - just the JSON.
3. If the user explicitly asks you to generate the plan, output the JSON immediately.

JSON FORMAT (output this EXACTLY when ready, nothing else):
{
    "proposedChanges": [{ "path": "file/path", "action": "modify|create|delete", "description": "what to change" }],
    "verificationPlan": "How to test the changes",
    "estimatedEffort": "X hours"
}

Remember: When outputting the plan, respond with ONLY the JSON. Do not say "I've created a plan" or describe it - just output the JSON object.`;


/**
 * POST /api/chat/planner
 * Send message to Planner and get response
 */
export async function POST(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { tag, message, projectId } = body;

        if (!tag || !message) {
            return NextResponse.json({ error: 'Tag and message required' }, { status: 400 });
        }

        // Resolve workspace tools and services
        const { loadProjectContext, invokeLLM, projectService, systemConfigService } = await import('@ai-swarm/shared');

        // Resolve project directory
        let projectDir = await systemConfigService.getDefaultProjectDir();
        if (projectId) {
            try {
                const project = await projectService.getProjectById(projectId);
                if (project && project.projectFolder) {
                    projectDir = project.projectFolder;
                }
            } catch (err) {
                console.warn(`Failed to resolve project ${projectId}, falling back to default:`, err);
            }
        }

        // Get current conversation
        const conversation = await getConversation(session.user.email, tag);
        if (!conversation) {
            return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
        }

        // Add user message
        await addMessage(session.user.email, tag, 'user', message);

        // Build conversation context
        const conversationHistory = conversation.messages
            .map((m) => `${m.role === 'user' ? 'USER' : 'PLANNER'}: ${m.content}`)
            .join('\n\n');

        // Load project context using resolved directory
        const projectContext = await loadProjectContext(projectDir);

        const fullPrompt = `${PLANNER_SYSTEM}${projectContext}

## Conversation History
${conversationHistory}

USER: ${message}

PLANNER:`;

        // Use centralized invokeLLM from @ai-swarm/shared
        // This provides model cascade support, timeout handling, and memory safety.
        // v3.0.0: Uses portal_planner role which is configured in LLM Settings
        try {
            const response = await invokeLLM(fullPrompt, {
                role: 'portal_planner',
                cwd: projectDir,
                timeout: 5 * 60 * 1000,
            });

            // Add assistant message
            const updatedConversation = await addMessage(
                session.user.email,
                tag,
                'assistant',
                response
            );

            return NextResponse.json({
                response,
                conversation: updatedConversation,
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Gemini error:', errorMessage);

            return NextResponse.json(
                { error: 'Failed to get response from Planner' },
                { status: 500 }
            );
        }
    } catch (error) {
        console.error('Planner API error:', error);
        return NextResponse.json(
            { error: 'Failed to process request' },
            { status: 500 }
        );
    }
}
