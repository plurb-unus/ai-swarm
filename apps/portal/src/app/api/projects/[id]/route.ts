/**
 * AI Swarm v3.0.0 - Single Project API
 * 
 * Get, update, delete a specific project.
 */

import { NextRequest, NextResponse } from 'next/server';
import { projectService } from '@ai-swarm/shared';

interface RouteParams {
    params: Promise<{ id: string }>;
}

// GET /api/projects/[id] - Get a single project
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;
        const project = await projectService.getProjectById(id);
        const deployment = await projectService.getProductionDeployment(id);
        return NextResponse.json({ project, deployment });
    } catch (error) {
        console.error('Failed to fetch project:', error);
        return NextResponse.json(
            { error: 'Project not found' },
            { status: 404 }
        );
    }
}

// PUT /api/projects/[id] - Update a project
export async function PUT(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;
        const body = await request.json();

        const project = await projectService.updateProject(id, {
            name: body.name,
            scmProvider: body.scmProvider,
            scmOrg: body.scmOrg,
            scmProject: body.scmProject,
            scmRepo: body.scmRepo,
            scmToken: body.scmToken,
            projectFolder: body.projectFolder,
            aiContextFolder: body.aiContextFolder,
            isActive: body.isActive,
        });

        return NextResponse.json({ project });
    } catch (error) {
        console.error('Failed to update project:', error);
        return NextResponse.json(
            { error: 'Failed to update project' },
            { status: 500 }
        );
    }
}

// DELETE /api/projects/[id] - Delete a project
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;
        await projectService.deleteProject(id);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete project:', error);
        return NextResponse.json(
            { error: 'Failed to delete project' },
            { status: 500 }
        );
    }
}
