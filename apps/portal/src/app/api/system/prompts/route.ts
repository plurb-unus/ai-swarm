/**
 * AI Swarm v3.0.0 - System Prompts API
 * 
 * Get and update prompts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { promptService } from '@ai-swarm/shared';

export const runtime = 'nodejs';

// GET /api/system/prompts - List all prompts
export async function GET() {
    try {
        const prompts = await promptService.getAllPrompts();
        return NextResponse.json({ prompts });
    } catch (error) {
        console.error('Failed to fetch prompts:', error);
        return NextResponse.json(
            { error: 'Failed to fetch prompts' },
            { status: 500 }
        );
    }
}

// PUT /api/system/prompts - Update a prompt
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();

        if (!body.name || !body.content) {
            return NextResponse.json(
                { error: 'Missing required fields: name, content' },
                { status: 400 }
            );
        }

        await promptService.updatePrompt(body.name, body.content);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to update prompt:', error);
        return NextResponse.json(
            { error: 'Failed to update prompt' },
            { status: 500 }
        );
    }
}

// POST /api/system/prompts - Reset a prompt to default
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        console.log('Prompt Reset Request:', body);

        if (!body.name) {
            return NextResponse.json(
                { error: 'Missing required field: name' },
                { status: 400 }
            );
        }

        if (body.action === 'reset') {
            const content = await promptService.resetPrompt(body.name);
            console.log('Prompt Reset Success:', body.name);
            return NextResponse.json({ success: true, content });
        }

        return NextResponse.json(
            { error: 'Invalid action' },
            { status: 400 }
        );
    } catch (error) {
        console.error('CRITICAL: Failed to reset prompt:', error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Failed to reset prompt',
                stack: error instanceof Error ? error.stack : undefined
            },
            { status: 500 }
        );
    }
}
