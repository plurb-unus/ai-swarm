/**
 * AI Swarm v3.0.0 - Project Deployments API
 */

import { NextRequest, NextResponse } from 'next/server';
import { projectService } from '@ai-swarm/shared';

interface RouteParams {
    params: Promise<{ id: string }>;
}

// GET /api/projects/[id]/deployments - List deployments for a project
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;
        const deployments = await projectService.getProjectDeployments(id);
        return NextResponse.json({ deployments });
    } catch (error) {
        console.error('Failed to fetch deployments:', error);
        return NextResponse.json(
            { error: 'Failed to fetch deployments' },
            { status: 500 }
        );
    }
}

// POST /api/projects/[id]/deployments - Create or update a deployment
export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;
        const body = await request.json();

        // Validate required fields
        const required = ['name', 'sshHost', 'sshUser', 'deployDir'];
        for (const field of required) {
            if (!body[field]) {
                return NextResponse.json(
                    { error: `Missing required field: ${field}` },
                    { status: 400 }
                );
            }
        }

        const deployment = await projectService.upsertDeployment(id, {
            name: body.name,
            sshHost: body.sshHost,
            sshUser: body.sshUser,
            deployDir: body.deployDir,
            appUrl: body.appUrl,
            metadata: body.metadata,
        });

        return NextResponse.json({ deployment }, { status: 201 });
    } catch (error) {
        console.error('Failed to create deployment:', error);
        return NextResponse.json(
            { error: 'Failed to create deployment' },
            { status: 500 }
        );
    }
}
