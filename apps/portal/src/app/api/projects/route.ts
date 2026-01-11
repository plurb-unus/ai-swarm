/**
 * AI Swarm v3.0.0 - Projects API
 * 
 * CRUD operations for projects.
 */

import { NextRequest, NextResponse } from 'next/server';
import { projectService } from '@ai-swarm/shared';

// GET /api/projects - List all projects
export async function GET() {
    try {
        const projects = await projectService.getAllProjects();
        return NextResponse.json({ projects });
    } catch (error) {
        console.error('Failed to fetch projects:', error);
        return NextResponse.json(
            { error: 'Failed to fetch projects' },
            { status: 500 }
        );
    }
}

// POST /api/projects - Create a new project
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        // Validate required fields
        const required = ['name', 'scmProvider', 'scmOrg', 'scmRepo'];
        for (const field of required) {
            if (!body[field]) {
                return NextResponse.json(
                    { error: `Missing required field: ${field}` },
                    { status: 400 }
                );
            }
        }

        const project = await projectService.createProject({
            name: body.name,
            scmProvider: body.scmProvider,
            scmOrg: body.scmOrg,
            scmProject: body.scmProject,
            scmRepo: body.scmRepo,
            scmToken: body.scmToken,
            projectFolder: body.projectFolder,
            aiContextFolder: body.aiContextFolder,
        });

        // v3.0.0: Immediately configure deployment if provided
        if (body.deployment) {
            await projectService.upsertDeployment(project.id, {
                name: 'production',
                sshHost: body.deployment.sshHost || '',
                sshUser: body.deployment.sshUser || '',
                deployDir: body.deployment.deployDir || '',
                appUrl: body.deployment.appUrl || '',
                metadata: {
                    deployServices: body.deployment.deployServices
                }
            });
        }

        return NextResponse.json({ project }, { status: 201 });
    } catch (error) {
        console.error('Failed to create project:', error);
        return NextResponse.json(
            { error: 'Failed to create project' },
            { status: 500 }
        );
    }
}
