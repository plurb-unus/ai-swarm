import { Pool, PoolClient } from 'pg';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';

// Connection details - relying on environment variables or defaults
// The Temporal Postgres instance is usually available at hostname 'postgres' or 'localhost' depending on where this runs
const pool = new Pool({
    user: process.env.POSTGRES_USER || 'temporal',
    host: process.env.POSTGRES_HOST || 'postgres',
    database: process.env.POSTGRES_DB || 'postgres', // Using default postgres DB for now, or create ai_swarm db?
    password: process.env.POSTGRES_PASSWORD || 'temporal',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
    const client = await pool.connect();
    try {
        logger.info('Running database migrations...');

        // v3.0.0: Run all migration files in order
        const migrationsDir = path.join(__dirname, 'migrations');
        const files = fs.readdirSync(migrationsDir).sort(); // Ensure order like 001, 002

        await client.query('BEGIN');

        for (const file of files) {
            if (file.endsWith('.sql')) {
                logger.info({ file }, 'Running migration');
                const migrationSql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
                await client.query(migrationSql);
            }
        }

        await client.query('COMMIT');

        logger.info({ count: files.filter(f => f.endsWith('.sql')).length }, 'Database migrations completed successfully');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ error }, 'Database migration failed');
        throw error;
    } finally {
        client.release();
    }
}


export async function seedDatabase() {
    const client = await pool.connect();
    try {
        logger.info('Seeding database...');
        await client.query('BEGIN');

        // 1. Seed default project if not exists
        const scmProvider = process.env.SCM_PROVIDER || 'azure-devops';
        const scmOrg = process.env.SCM_ORG || 'ai-swarm-dev';
        const scmRepo = process.env.SCM_REPO || 'ai-swarm';
        const scmProject = process.env.SCM_PROJECT || 'core';
        const projectName = process.env.DEFAULT_PROJECT_NAME || 'Default Project';

        const projectRes = await client.query(
            `INSERT INTO projects (name, scm_provider, scm_org, scm_project, scm_repo)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (name) DO UPDATE SET 
                scm_provider = EXCLUDED.scm_provider,
                scm_org = EXCLUDED.scm_org,
                scm_project = EXCLUDED.scm_project,
                scm_repo = EXCLUDED.scm_repo
             RETURNING id`,
            [projectName, scmProvider, scmOrg, scmProject, scmRepo]
        );
        const projectId = projectRes.rows[0].id;
        logger.info({ projectId, projectName }, 'Seeded default project');

        // 2. Seed Secrets (SCM Token)
        if (process.env.SCM_TOKEN) {
            await client.query(
                `INSERT INTO secrets (project_id, key, value)
                 VALUES ($1, 'SCM_TOKEN', $2)
                 ON CONFLICT (project_id, key) DO UPDATE SET value = EXCLUDED.value`,
                [projectId, process.env.SCM_TOKEN]
            );
        }

        // 3. Seed Deployments
        if (process.env.DEPLOY_HOST) {
            await client.query(
                `INSERT INTO deployments (project_id, name, ssh_host, ssh_user, deploy_dir, app_url)
                 VALUES ($1, 'production', $2, $3, $4, $5)
                 ON CONFLICT (project_id, name) DO UPDATE SET
                    ssh_host = EXCLUDED.ssh_host,
                    ssh_user = EXCLUDED.ssh_user,
                    deploy_dir = EXCLUDED.deploy_dir,
                    app_url = EXCLUDED.app_url`,
                [
                    projectId,
                    process.env.DEPLOY_HOST,
                    process.env.DEPLOY_USER || 'ubuntu',
                    process.env.DEPLOY_DIR || '/home/ubuntu/apps/ai-swarm',
                    process.env.APP_URL
                ]
            );
        }

        // 4. v3.0.0: Seed Deployer Blacklist (only if not already set)
        const defaultBlacklist = 'temporal-server,postgres,redis,traefik,portainer,ai-swarm-portal,ai-swarm-worker-1,ai-swarm-worker-2,ai-swarm-worker-3,ai-swarm-worker-4,ai-swarm-worker-5,ai-swarm-worker-6,ai-swarm-worker-7,ai-swarm-worker-8,ai-swarm-playwright,ai-swarm-builder';
        await client.query(
            `INSERT INTO system_config (key, value)
             VALUES ('deployer_blacklist', $1)
             ON CONFLICT (key) DO NOTHING`,
            [defaultBlacklist]
        );
        logger.info('Seeded deployer_blacklist default');

        // Seed Prompts from Files
        // When running from dist/db/seed.js, we need to go up two levels to reach packages/shared/
        const projectRoot = path.resolve(__dirname, '../..');
        let promptsPath = path.join(projectRoot, 'prompts');

        // v3.0.0: Fallback to Docker locations
        const searchPaths = [
            promptsPath, // Check the default correct path first
            path.join(__dirname, '../../prompts'),
            '/opt/ai-swarm/prompts'
        ];

        let effectivePromptsPath = '';
        for (const p of searchPaths) {
            if (fs.existsSync(p)) {
                effectivePromptsPath = p;
                break;
            }
        }

        if (effectivePromptsPath) {
            logger.info({ promptsPath: effectivePromptsPath }, 'Seeding prompts from directory');
            const files = fs.readdirSync(effectivePromptsPath);
            if (files.length === 0) {
                logger.warn({ promptsPath: effectivePromptsPath }, 'Prompts directory is empty');
            }
            for (const file of files) {
                if (file.endsWith('.md')) { // only seed .md files
                    const name = file.replace('.md', '');
                    const content = fs.readFileSync(path.join(effectivePromptsPath, file), 'utf8');

                    // Check if prompt exists to avoid overwriting newer versions with seed data
                    // actually, for seed, we probably want to ensure the BASE version exists?
                    // or should we update? The request is to make them editable.
                    // If we blindly update, we overwrite user edits on every restart?
                    // The query below uses ON CONFLICT DO UPDATE.
                    // But we should only insert if it doesn't exist?
                    // Original code: ON CONFLICT (name, version) DO UPDATE SET content = EXCLUDED.content
                    // This resets version 1.

                    // Allow the seed to update Version 1. User edits will be Version 2+.
                    await client.query(
                        `INSERT INTO prompts (name, version, content, is_active)
                         VALUES ($1, 1, $2, true)
                         ON CONFLICT (name, version) DO UPDATE SET content = EXCLUDED.content`,
                        [name, content]
                    );
                    logger.info({ name }, 'Seeded Prompt (v1)');
                }
            }
        } else {
            logger.warn('No prompts directory found for seeding');
        }

        await client.query('COMMIT');
        logger.info('Database seeding completed successfully');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ error }, 'Database seeding failed');
        throw error;
    } finally {
        client.release();
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        try {
            await runMigrations();
            await seedDatabase();
            await pool.end();
            process.exit(0);
        } catch (e) {
            console.error(e);
            process.exit(1);
        }
    })();
}
