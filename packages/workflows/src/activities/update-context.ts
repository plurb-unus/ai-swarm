/**
 * AI Swarm v3.0.0 - Update Project Context Activity
 *
 * Analyzes code changes and updates relevant .aicontext files.
 * Called by the Reviewer role after code review passes.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { logger, logActivityStart, logActivityComplete, invokeLLM } from '@ai-swarm/shared';

const execAsync = promisify(exec);

export interface UpdateContextInput {
    taskId: string;
    projectDir: string;
    taskDescription: string;
    changedFiles: string[];
}

export interface UpdateContextOutput {
    success: boolean;
    updatedFiles: string[];
    error?: string;
}

interface ContextUpdate {
    file: string;
    action: 'append' | 'replace_section';
    content: string;
    section?: string;
}

const AI_CONTEXT_DIR = '.aicontext';

/**
 * Analyze code changes and update relevant .aicontext files.
 * Called by the Reviewer role after code review passes.
 */
export async function updateProjectContext(input: UpdateContextInput): Promise<UpdateContextOutput> {
    const startTime = Date.now();
    logActivityStart('reviewer', 'updateProjectContext', { taskId: input.taskId });

    const aiContextPath = join(input.projectDir, AI_CONTEXT_DIR);

    // Check if .aicontext exists
    if (!existsSync(aiContextPath)) {
        logger.info({ projectDir: input.projectDir }, 'No .aicontext directory, skipping context update');
        return { success: true, updatedFiles: [] };
    }

    try {
        // Get diff of changes
        let diff = '';
        try {
            const result = await execAsync(
                'git diff HEAD~1 --no-color',
                { cwd: input.projectDir, maxBuffer: 10 * 1024 * 1024 }
            );
            diff = result.stdout;
        } catch {
            // If diff fails (no previous commit), use staged changes
            const result = await execAsync(
                'git diff --cached --no-color',
                { cwd: input.projectDir, maxBuffer: 10 * 1024 * 1024 }
            );
            diff = result.stdout;
        }

        // List existing .aicontext files
        const contextFiles = readdirSync(aiContextPath)
            .filter(f => f.endsWith('.md'))
            .map(f => ({
                name: f,
                content: readFileSync(join(aiContextPath, f), 'utf-8').substring(0, 2000),
            }));

        // Build analysis prompt
        const prompt = buildContextAnalysisPrompt(input, diff, contextFiles);

        // Use centralized invokeLLM which respects system configuration for 'reviewer' role
        logger.info({ taskId: input.taskId }, 'Invoking LLM for context analysis (Reviewer role)');

        let response = '';
        try {
            // v3.0.1: Respects 'reviewer' role provider (Gemini or Claude)
            response = await invokeLLM(prompt, {
                role: 'reviewer',
                cwd: input.projectDir,
                timeout: 60000
            });
        } catch (llmError) {
            logger.warn({ error: llmError }, 'LLM analysis failed, skipping context update');
            return { success: true, updatedFiles: [] };
        }

        // Parse LLM response and apply updates
        const updates = parseContextUpdates(response);
        const updatedFiles: string[] = [];

        for (const update of updates) {
            const filePath = join(aiContextPath, update.file);

            try {
                if (update.action === 'append') {
                    const existing = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
                    writeFileSync(filePath, existing + '\n' + update.content);
                    logger.info({ file: update.file }, 'Appended to context file');
                } else if (update.action === 'replace_section' && update.section) {
                    if (existsSync(filePath)) {
                        const existing = readFileSync(filePath, 'utf-8');
                        const updated = replaceSectionInMarkdown(existing, update.section, update.content);
                        writeFileSync(filePath, updated);
                        logger.info({ file: update.file, section: update.section }, 'Replaced section in context file');
                    }
                }
                updatedFiles.push(update.file);
            } catch (writeError) {
                logger.warn({ file: update.file, error: writeError }, 'Failed to update context file');
            }
        }

        // Stage and amend commit if files were updated
        if (updatedFiles.length > 0) {
            try {
                await execAsync(`git add ${AI_CONTEXT_DIR}/`, { cwd: input.projectDir });

                try {
                    await execAsync('git commit --amend --no-edit', { cwd: input.projectDir });
                    logger.info({ updatedFiles }, 'Context files added to existing commit');
                } catch {
                    // Amend failed, create separate commit
                    await execAsync('git commit -m "docs: update .aicontext"', { cwd: input.projectDir });
                    logger.info({ updatedFiles }, 'Context files committed separately');
                }
            } catch (gitError) {
                logger.warn({ error: gitError }, 'Failed to commit context updates');
            }
        }

        const durationMs = Date.now() - startTime;
        logActivityComplete('reviewer', 'updateProjectContext', durationMs, true);

        return { success: true, updatedFiles };
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('reviewer', 'updateProjectContext', durationMs, false);

        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage, taskId: input.taskId }, 'Failed to update project context');

        return { success: false, updatedFiles: [], error: errorMessage };
    }
}

function buildContextAnalysisPrompt(
    input: UpdateContextInput,
    diff: string,
    contextFiles: { name: string; content: string }[]
): string {
    return `You are analyzing code changes to determine if project documentation needs updating.

## Task Description
${input.taskDescription}

## Changed Files
${input.changedFiles.slice(0, 20).join('\\n')}

## Code Diff (truncated)
\`\`\`diff
${diff.substring(0, 6000)}
\`\`\`

## Existing .aicontext Files
${contextFiles.map(f => `### ${f.name}\\n${f.content}`).join('\\n\\n')}

## Instructions
Analyze the changes and determine which .aicontext files need updates:
- FEATURE_HISTORY.md: New features, enhancements
- ARCHITECTURE.md: Structural changes, new components
- DATABASE.md: Schema changes, new tables/fields
- API_REFERENCE.md: New endpoints, changed APIs
- TROUBLESHOOTING.md: Known issues, workarounds
- DEPLOYMENT.md: Deployment process changes

Return ONLY a JSON array of updates (no other text):
[{"file": "FEATURE_HISTORY.md", "action": "append", "content": "## 2026-01-03: Feature..."}]

If no updates are needed, return: []`;
}

function parseContextUpdates(response: string): ContextUpdate[] {
    try {
        const jsonMatch = response.match(/\[[\s\S]*?\]/);
        if (!jsonMatch) return [];
        const parsed = JSON.parse(jsonMatch[0]);
        // Filter out updates with missing required fields
        return parsed.filter((u: any) =>
            u && typeof u.file === 'string' &&
            typeof u.action === 'string' &&
            typeof u.content === 'string'
        );
    } catch {
        logger.warn('Failed to parse context updates JSON from LLM response');
        return [];
    }
}

function replaceSectionInMarkdown(content: string, section: string, newContent: string): string {
    const sectionRegex = new RegExp(`(## ${section}[\\s\\S]*?)(?=\\n## |$)`, 'i');
    if (sectionRegex.test(content)) {
        return content.replace(sectionRegex, newContent);
    }
    // Section not found, append
    return content + '\n\n' + newContent;
}
