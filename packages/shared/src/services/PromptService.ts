/**
 * AI Swarm v3.0.0 - Prompt Service
 * 
 * Fetches system prompts from the database.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from '../db.js';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PromptService {
    async getActivePrompt(name: string): Promise<string> {
        const pool = getPool();

        // v3.0.0: Fetch latest active version
        const result = await pool.query(
            `SELECT content FROM prompts 
             WHERE name = $1 AND is_active = true 
             ORDER BY version DESC LIMIT 1`,
            [name]
        );

        if (result.rows.length === 0) {
            logger.warn({ name }, 'Prompt not found in database, check seed.');
            throw new Error(`Prompt '${name}' not found in database.`);
        }

        return result.rows[0].content;
    }

    /**
     * v3.0.0: Get all prompts for management UI
     */
    async getAllPrompts(): Promise<Array<{
        id: string;
        name: string;
        version: number;
        content: string;
        isActive: boolean;
        createdAt: Date;
    }>> {
        const pool = getPool();
        const result = await pool.query(
            `SELECT id, name, version, content, is_active, created_at 
             FROM prompts 
             ORDER BY name, version DESC`
        );

        return result.rows.map(row => ({
            id: row.id,
            name: row.name,
            version: row.version,
            content: row.content,
            isActive: row.is_active,
            createdAt: row.created_at
        }));
    }

    /**
     * v3.0.0: Update prompt content in-place (no more versioning)
     */
    async updatePrompt(name: string, content: string): Promise<void> {
        const pool = getPool();

        // Update the active version for this prompt
        const res = await pool.query(
            `UPDATE prompts 
             SET content = $1, created_at = NOW()
             WHERE name = $2 AND is_active = true`,
            [content, name]
        );

        if (res.rowCount === 0) {
            // If no active row, insert as version 1
            await pool.query(
                `INSERT INTO prompts (name, version, content, is_active) 
                 VALUES ($1, 1, $2, true)
                 ON CONFLICT (name, version) DO UPDATE SET content = EXCLUDED.content`,
                [name, content]
            );
        }

        logger.info({ name }, 'Prompt updated (in-place)');
    }
    /**
     * v3.0.0: Reset prompt to default from file system
     */
    async resetPrompt(name: string): Promise<string> {
        const pool = getPool();

        // 1. Locate default file
        const defaultPath = `/opt/ai-swarm/prompts/${name}.md`;
        let content = '';

        try {
            if (fs.existsSync(defaultPath)) {
                content = fs.readFileSync(defaultPath, 'utf8');
            } else {
                // Fallback for local development
                // We are at packages/shared/dist/services/PromptService.js (usually)
                // Source prompts are at project_root/prompts/
                const localPath = path.resolve(__dirname, '../../../../prompts', `${name}.md`);
                if (fs.existsSync(localPath)) {
                    content = fs.readFileSync(localPath, 'utf8');
                } else if (name === 'claude-identity') {
                    // Check shared prompts for identity
                    const sharedPath = path.resolve(__dirname, '../../prompts/claude-identity.md');
                    if (fs.existsSync(sharedPath)) {
                        content = fs.readFileSync(sharedPath, 'utf8');
                    }
                }
            }
        } catch (err) {
            logger.warn({ err, name }, 'Failed to read default prompt file');
        }

        if (!content) {
            throw new Error(`Default prompt file not found for '${name}'`);
        }

        // 2. Create new version with default content
        await this.updatePrompt(name, content);
        return content;
    }
}

export const promptService = new PromptService();
