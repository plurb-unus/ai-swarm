import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
    createConversation,
    getConversation,
    addMessage,
    listConversations,
    deleteConversation,
} from '@/lib/chat-storage';

/**
 * GET /api/chat
 * List user's conversations
 */
export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tag = searchParams.get('tag');

    try {
        if (tag) {
            // Get specific conversation
            const conversation = await getConversation(session.user.email, tag);
            if (!conversation) {
                return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
            }
            return NextResponse.json(conversation);
        } else {
            // List all conversations
            const conversations = await listConversations(session.user.email);
            return NextResponse.json({ conversations });
        }
    } catch (error) {
        console.error('Chat API error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch conversations' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/chat
 * Create new conversation or add message
 */
export async function POST(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { tag, message, action } = body;

        if (action === 'new') {
            // Create new conversation
            if (!message) {
                return NextResponse.json({ error: 'Message required' }, { status: 400 });
            }
            const conversation = await createConversation(session.user.email, message);
            return NextResponse.json(conversation);
        }

        if (action === 'message') {
            // Add message to existing conversation
            if (!tag || !message) {
                return NextResponse.json({ error: 'Tag and message required' }, { status: 400 });
            }
            const conversation = await addMessage(
                session.user.email,
                tag,
                'user',
                message
            );
            if (!conversation) {
                return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
            }
            return NextResponse.json(conversation);
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error) {
        console.error('Chat API error:', error);
        return NextResponse.json(
            { error: 'Failed to process request' },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/chat
 * Delete a conversation
 */
export async function DELETE(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tag = searchParams.get('tag');

    if (!tag) {
        return NextResponse.json({ error: 'Tag required' }, { status: 400 });
    }

    try {
        const deleted = await deleteConversation(session.user.email, tag);
        if (!deleted) {
            return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Chat API error:', error);
        return NextResponse.json(
            { error: 'Failed to delete conversation' },
            { status: 500 }
        );
    }
}
