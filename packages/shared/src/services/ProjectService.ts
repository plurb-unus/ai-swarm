/**
 * AI Swarm v3.0.0 - Project Service
 * 
 * Multi-project CRUD operations. Replaces single-project limitation.
 */

import { getPool } from '../db.js';
import { logger } from '../logger.js';

export interface ProjectConfig {
    id: string;
    name: string;
    scmProvider: string;
    scmOrg: string;
    scmProject?: string;
    scmRepo: string;
    scmToken?: string;
    projectFolder: string;
    aiContextFolder: string;
    isActive: boolean;
    createdAt: Date;
}

export interface CreateProjectInput {
    name: string;
    scmProvider: string;
    scmOrg: string;
    scmProject?: string;
    scmRepo: string;
    scmToken?: string;
    projectFolder?: string;
    aiContextFolder?: string;
}

export interface UpdateProjectInput {
    name?: string;
    scmProvider?: string;
    scmOrg?: string;
    scmProject?: string;
    scmRepo?: string;
    scmToken?: string;
    projectFolder?: string;
    aiContextFolder?: string;
    isActive?: boolean;
}

export interface Deployment {
    id: string;
    projectId: string;
    name: string;
    sshHost: string;
    sshUser: string;
    deployDir: string;
    appUrl?: string;
    isActive: boolean;
    metadata?: Record<string, unknown>;
}

export interface DeploymentInput {
    name: string;
    sshHost: string;
    sshUser: string;
    deployDir: string;
    appUrl?: string;
    metadata?: Record<string, unknown>;
}

export class ProjectService {
    /**
     * Get all projects
     */
    async getAllProjects(): Promise<ProjectConfig[]> {
        const pool = getPool();
        const result = await pool.query(
            `SELECT * FROM projects ORDER BY name`
        );

        return result.rows.map(this.mapRowToProject);
    }

    /**
     * Get a single project by ID
     */
    async getProjectById(id: string): Promise<ProjectConfig> {
        const pool = getPool();
        const result = await pool.query(
            `SELECT * FROM projects WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            throw new Error(`Project with id '${id}' not found`);
        }

        return this.mapRowToProject(result.rows[0]);
    }

    /**
     * Get the first active project (for backward compatibility during migration)
     */
    async getActiveProject(): Promise<ProjectConfig> {
        const pool = getPool();
        const result = await pool.query(
            `SELECT * FROM projects WHERE is_active = true LIMIT 1`
        );

        if (result.rows.length === 0) {
            throw new Error('No active project found in database. Did you run seed.ts?');
        }

        return this.mapRowToProject(result.rows[0]);
    }

    /**
     * Create a new project
     */
    async createProject(data: CreateProjectInput): Promise<ProjectConfig> {
        const pool = getPool();
        const result = await pool.query(
            `INSERT INTO projects (name, scm_provider, scm_org, scm_project, scm_repo, scm_token, base_path, ai_context_folder)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
                data.name,
                data.scmProvider,
                data.scmOrg,
                data.scmProject || null,
                data.scmRepo,
                data.scmToken || null,
                data.projectFolder || '/project',
                data.aiContextFolder || '.aicontext'
            ]
        );

        logger.info({ projectId: result.rows[0].id, name: data.name }, 'Project created');
        return this.mapRowToProject(result.rows[0]);
    }

    /**
     * Update an existing project
     */
    async updateProject(id: string, data: UpdateProjectInput): Promise<ProjectConfig> {
        const pool = getPool();

        // Build dynamic update query
        const updates: string[] = [];
        const values: unknown[] = [];
        let paramIndex = 1;

        if (data.name !== undefined) {
            updates.push(`name = $${paramIndex++}`);
            values.push(data.name);
        }
        if (data.scmProvider !== undefined) {
            updates.push(`scm_provider = $${paramIndex++}`);
            values.push(data.scmProvider);
        }
        if (data.scmOrg !== undefined) {
            updates.push(`scm_org = $${paramIndex++}`);
            values.push(data.scmOrg);
        }
        if (data.scmProject !== undefined) {
            updates.push(`scm_project = $${paramIndex++}`);
            values.push(data.scmProject);
        }
        if (data.scmRepo !== undefined) {
            updates.push(`scm_repo = $${paramIndex++}`);
            values.push(data.scmRepo);
        }
        if (data.scmToken !== undefined) {
            updates.push(`scm_token = $${paramIndex++}`);
            values.push(data.scmToken || null);
        }
        if (data.projectFolder !== undefined) {
            updates.push(`base_path = $${paramIndex++}`);
            values.push(data.projectFolder);
        }
        if (data.aiContextFolder !== undefined) {
            updates.push(`ai_context_folder = $${paramIndex++}`);
            values.push(data.aiContextFolder);
        }
        if (data.isActive !== undefined) {
            updates.push(`is_active = $${paramIndex++}`);
            values.push(data.isActive);
        }

        if (updates.length === 0) {
            return this.getProjectById(id);
        }

        values.push(id);
        const result = await pool.query(
            `UPDATE projects SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            throw new Error(`Project with id '${id}' not found`);
        }

        logger.info({ projectId: id }, 'Project updated');
        return this.mapRowToProject(result.rows[0]);
    }

    /**
     * Delete a project
     */
    async deleteProject(id: string): Promise<void> {
        const pool = getPool();
        const result = await pool.query(
            `DELETE FROM projects WHERE id = $1`,
            [id]
        );

        if (result.rowCount === 0) {
            throw new Error(`Project with id '${id}' not found`);
        }

        logger.info({ projectId: id }, 'Project deleted');
    }

    /**
     * Get deployments for a project
     */
    async getProjectDeployments(projectId: string): Promise<Deployment[]> {
        const pool = getPool();
        const result = await pool.query(
            `SELECT * FROM deployments WHERE project_id = $1 ORDER BY name`,
            [projectId]
        );

        return result.rows.map(row => ({
            id: row.id,
            projectId: row.project_id,
            name: row.name,
            sshHost: row.ssh_host,
            sshUser: row.ssh_user,
            deployDir: row.deploy_dir,
            appUrl: row.app_url,
            isActive: row.is_active,
            metadata: row.metadata
        }));
    }

    /**
     * Get the production deployment for a project (default)
     */
    async getProductionDeployment(projectId: string): Promise<Deployment | null> {
        const pool = getPool();
        const result = await pool.query(
            `SELECT * FROM deployments WHERE project_id = $1 AND (name = 'production' OR name = 'default') LIMIT 1`,
            [projectId]
        );

        if (result.rows.length === 0) {
            return null;
        }

        const row = result.rows[0];
        return {
            id: row.id,
            projectId: row.project_id,
            name: row.name,
            sshHost: row.ssh_host,
            sshUser: row.ssh_user,
            deployDir: row.deploy_dir,
            appUrl: row.app_url,
            isActive: row.is_active,
            metadata: row.metadata
        };
    }

    /**
     * Create or update a deployment
     */
    async upsertDeployment(projectId: string, data: DeploymentInput): Promise<Deployment> {
        const pool = getPool();
        const result = await pool.query(
            `INSERT INTO deployments (project_id, name, ssh_host, ssh_user, deploy_dir, app_url, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (project_id, name) DO UPDATE SET
                ssh_host = EXCLUDED.ssh_host,
                ssh_user = EXCLUDED.ssh_user,
                deploy_dir = EXCLUDED.deploy_dir,
                app_url = EXCLUDED.app_url,
                metadata = EXCLUDED.metadata
             RETURNING *`,
            [
                projectId,
                data.name,
                data.sshHost,
                data.sshUser,
                data.deployDir,
                data.appUrl || null,
                data.metadata ? JSON.stringify(data.metadata) : null
            ]
        );

        const row = result.rows[0];
        logger.info({ projectId, deploymentName: data.name }, 'Deployment upserted');

        return {
            id: row.id,
            projectId: row.project_id,
            name: row.name,
            sshHost: row.ssh_host,
            sshUser: row.ssh_user,
            deployDir: row.deploy_dir,
            appUrl: row.app_url,
            isActive: row.is_active,
            metadata: row.metadata
        };
    }

    /**
     * Get secrets for a project
     */
    async getProjectSecrets(projectId: string): Promise<Record<string, string>> {
        const pool = getPool();
        const result = await pool.query(
            `SELECT key, value FROM secrets WHERE project_id = $1`,
            [projectId]
        );

        const secrets: Record<string, string> = {};
        for (const row of result.rows) {
            secrets[row.key] = row.value;
        }
        return secrets;
    }

    /**
     * Set a secret for a project
     */
    async setProjectSecret(projectId: string, key: string, value: string): Promise<void> {
        const pool = getPool();
        await pool.query(
            `INSERT INTO secrets (project_id, key, value)
             VALUES ($1, $2, $3)
             ON CONFLICT (project_id, key) DO UPDATE SET value = EXCLUDED.value`,
            [projectId, key, value]
        );
        logger.info({ projectId, key }, 'Secret updated');
    }

    private mapRowToProject(row: Record<string, unknown>): ProjectConfig {
        return {
            id: row.id as string,
            name: row.name as string,
            scmProvider: row.scm_provider as string,
            scmOrg: row.scm_org as string,
            scmProject: row.scm_project as string | undefined,
            scmRepo: row.scm_repo as string,
            scmToken: row.scm_token as string | undefined,
            projectFolder: row.base_path as string,
            aiContextFolder: row.ai_context_folder as string,
            isActive: row.is_active as boolean,
            createdAt: row.created_at as Date
        };
    }
}

export const projectService = new ProjectService();
