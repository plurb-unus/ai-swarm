/**
 * AI Swarm v2 - Worktree Manager
 *
 * Handles creation, listing, and removal of git worktrees for parallel task development.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import {
    logger,
    logActivityStart,
    logActivityComplete,
    projectService,
} from '@ai-swarm/shared';

const execAsync = promisify(exec);

/**
 * Configure git credential helper for HTTPS authentication.
 * Gets the SCM token from: 1) project record, 2) secrets table, 3) global provider token.
 * v3.0.0: Added to support HTTPS git remotes with PAT tokens.
 */
async function configureGitCredentials(projectId: string | undefined, cwd: string): Promise<void> {
    if (!projectId) {
        logger.debug('No projectId provided, skipping git credential configuration');
        return;
    }

    try {
        // First try to get token from project record (v3.0.0 primary location)
        const project = await projectService.getProjectById(projectId);
        let scmToken = project.scmToken;
        let tokenSource = 'project';

        // Fall back to secrets table
        if (!scmToken) {
            const secrets = await projectService.getProjectSecrets(projectId);
            scmToken = secrets['SCM_TOKEN'];
            tokenSource = 'secrets';
        }

        // Fall back to global provider token from system config
        if (!scmToken && project.scmProvider) {
            const { systemConfigService } = await import('@ai-swarm/shared');
            const provider = project.scmProvider as 'azure-devops' | 'github' | 'gitlab';
            scmToken = await systemConfigService.getScmTokenForProvider(provider);
            tokenSource = 'global';
        }

        if (!scmToken) {
            logger.debug({ projectId }, 'No SCM token found for project, using default git config');
            return;
        }

        // Configure git to use the token via credential helper
        // This uses a one-shot credential helper that provides the token for any HTTPS request
        const credentialHelper = `!f() { echo "username=x-token-auth"; echo "password=${scmToken}"; }; f`;

        await execAsync(`git config credential.helper '${credentialHelper}'`, { cwd });
        logger.info({ projectId, tokenSource }, 'Configured git credential helper');
    } catch (err) {
        logger.warn({ err, projectId }, 'Failed to configure git credentials, git operations may fail');
    }
}

/**
 * Ensure 'worktrees/' is in the project's .gitignore file.
 */
async function ensureWorktreeGitIgnore(baseDir: string): Promise<void> {
    const gitignorePath = path.join(baseDir, '.gitignore');
    try {
        let content = '';
        try {
            content = await fs.readFile(gitignorePath, 'utf8');
        } catch (err) {
            // File doesn't exist, will create it
        }

        if (!content.includes('worktrees/') && !content.includes('worktrees')) {
            logger.info({ baseDir }, 'Adding worktrees/ to .gitignore');
            const newContent = content.endsWith('\n') || content === ''
                ? `${content}worktrees/\n`
                : `${content}\nworktrees/\n`;
            await fs.writeFile(gitignorePath, newContent);
        }
    } catch (err) {
        logger.warn({ err, baseDir }, 'Failed to ensure worktrees/ in .gitignore');
    }
}

export interface WorktreeInfo {
    path: string;
    branch: string;
    taskId: string;
}

/**
 * Create a new worktree for a task.
 * v3.0.0: Added projectId parameter for multi-project support
 */
export async function createWorktree(taskId: string, type: string, slug: string, projectId?: string): Promise<WorktreeInfo> {
    const startTime = Date.now();
    logActivityStart('worktree', 'createWorktree', { taskId, projectId });

    // v3.0.0: Resolve project directory from projectId
    let baseDir = process.env.PROJECT_DIR || process.cwd();
    if (projectId) {
        try {
            const project = await projectService.getProjectById(projectId);
            if (project && project.projectFolder) {
                baseDir = project.projectFolder;
                logger.info({ projectId, baseDir }, 'Resolved project directory for worktree');
            }
        } catch (err) {
            logger.warn({ err, projectId }, 'Failed to resolve project for worktree, using default');
        }
    }
    const worktreesDir = path.join(baseDir, 'worktrees');

    // Ensure worktrees directory exists in the base repo
    await fs.mkdir(worktreesDir, { recursive: true });

    // v3.0.0: Ensure worktrees/ is ignored by git to prevent accidental commits
    await ensureWorktreeGitIgnore(baseDir);

    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const worktreeName = `task-${dateStr}-${type}-${slug}`;
    const worktreePath = path.join(worktreesDir, worktreeName);
    const branchName = `task/${worktreeName}`;

    try {
        logger.info({ worktreeName, worktreePath }, 'Creating git worktree');

        // v3.0.0: Configure git credentials before any git operations
        await configureGitCredentials(projectId, baseDir);

        // 1. Fetch latest main
        await execAsync('git fetch origin main', { cwd: baseDir });

        // 2. Clean up any existing local branch with same name (for retries)
        try {
            await execAsync(`git branch -D ${branchName}`, { cwd: baseDir });
            logger.info({ branchName }, 'Deleted existing local branch before worktree creation');
        } catch {
            // Branch doesn't exist, that's fine
        }

        // 3. Clean up any existing remote branch with same name (for retries)
        try {
            await execAsync(`git push origin --delete ${branchName}`, { cwd: baseDir });
            logger.info({ branchName }, 'Deleted existing remote branch before worktree creation');
        } catch {
            // Remote branch doesn't exist, that's fine
        }

        // 4. Remove existing worktree if registered with git
        try {
            await execAsync(`git worktree remove --force ${worktreePath}`, { cwd: baseDir });
            logger.info({ worktreePath }, 'Removed existing git worktree before creation');
        } catch {
            // Worktree not registered, that's fine - we'll clean the directory next
        }

        // 5. ALWAYS force-remove the directory (handles orphaned directories)
        try {
            await fs.rm(worktreePath, { recursive: true, force: true });
            logger.info({ worktreePath }, 'Removed existing worktree directory');
        } catch {
            // Directory doesn't exist, that's fine
        }

        // 6. Prune worktrees to clean up any stale references
        try {
            await execAsync('git worktree prune', { cwd: baseDir });
        } catch {
            // Ignore prune errors
        }

        // 5. Add worktree
        // git worktree add [-b <new-branch>] <path> [<commit-ish>]
        await execAsync(`git worktree add -b ${branchName} ${worktreePath} origin/main`, { cwd: baseDir });

        const durationMs = Date.now() - startTime;
        logActivityComplete('worktree', 'createWorktree', durationMs, true);

        return {
            path: worktreePath,
            branch: branchName,
            taskId,
        };
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('worktree', 'createWorktree', durationMs, false);

        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage, taskId }, 'Failed to create worktree');
        throw error;
    }
}

/**
 * Remove a worktree and its associated branch.
 * v3.0.0: Extracts project base path from worktree path for multi-project support
 */
export async function removeWorktree(worktreePath: string, force: boolean = false): Promise<void> {
    const startTime = Date.now();
    logActivityStart('worktree', 'removeWorktree', { worktreePath });

    // v3.0.0: Extract project base path from worktree path
    // Worktree path format: /apps/project/repo/worktrees/task-xxxx
    // So the project base is: /apps/project/repo (parent of 'worktrees' dir)
    let baseDir = process.env.PROJECT_DIR || process.cwd();
    const worktreesDirIndex = worktreePath.lastIndexOf('/worktrees/');
    if (worktreesDirIndex !== -1) {
        baseDir = worktreePath.substring(0, worktreesDirIndex);
    }

    try {
        logger.info({ worktreePath, baseDir }, 'Removing git worktree');

        // 1. Check if baseDir is a valid git repo first
        try {
            await execAsync('git rev-parse --git-dir', { cwd: baseDir });
        } catch {
            // Not a git repo - just try to delete the worktree directory
            logger.warn({ baseDir }, 'Base dir is not a git repo, directly removing worktree directory');
            try {
                await fs.rm(worktreePath, { recursive: true, force: true });
                logger.info({ worktreePath }, 'Worktree directory removed directly');
            } catch (rmErr) {
                logger.debug({ rmErr }, 'Failed to remove worktree directory - may not exist');
            }
            const durationMs = Date.now() - startTime;
            logActivityComplete('worktree', 'removeWorktree', durationMs, true);
            return;
        }

        // 2. Get branch name before removing
        const { stdout } = await execAsync(`git worktree list --porcelain`, { cwd: baseDir });
        const lines = stdout.split('\n');
        let branchName = '';

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith(`worktree ${worktreePath}`)) {
                // The next line might be 'branch refs/heads/...'
                if (lines[i + 1] && lines[i + 1].startsWith('branch ')) {
                    branchName = lines[i + 1].replace('branch refs/heads/', '');
                }
                break;
            }
        }

        // 3. Remove worktree (always use --force to handle untracked files from coding)
        await execAsync(`git worktree remove --force ${worktreePath}`, { cwd: baseDir });

        // 4. Delete branch if found
        if (branchName) {
            try {
                await execAsync(`git branch -D ${branchName}`, { cwd: baseDir });
                logger.info({ branchName }, 'Deleted associated branch');
            } catch (err) {
                logger.warn({ branchName, err }, 'Failed to delete branch after worktree removal');
            }
        }

        const durationMs = Date.now() - startTime;
        logActivityComplete('worktree', 'removeWorktree', durationMs, true);
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('worktree', 'removeWorktree', durationMs, false);

        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage, worktreePath, baseDir }, 'Failed to remove worktree');
        throw error;
    }
}

/**
 * List all active task worktrees.
 */
export async function listWorktrees(): Promise<string[]> {
    const baseDir = process.env.PROJECT_DIR || process.cwd();
    try {
        const { stdout } = await execAsync('git worktree list', { cwd: baseDir });
        return stdout.trim().split('\n');
    } catch {
        return [];
    }
}

/**
 * Prune stale worktrees older than 24 hours.
 */
export async function pruneWorktrees(): Promise<{ pruned: number }> {
    const startTime = Date.now();
    logActivityStart('worktree', 'pruneWorktrees', {});

    const baseDir = process.env.PROJECT_DIR || process.cwd();
    const worktreesDir = path.join(baseDir, 'worktrees');
    let pruned = 0;

    try {
        // 1. Run standard git prune
        await execAsync('git worktree prune', { cwd: baseDir });

        // 2. Manual cleanup of old directories
        const entries = await fs.readdir(worktreesDir).catch(() => [] as string[]);
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const name of entries) {
            const fullPath = path.join(worktreesDir, name);
            try {
                const stats = await fs.stat(fullPath);
                if (now - stats.mtimeMs > maxAge) {
                    logger.info({ worktreePath: fullPath }, 'Pruning stale worktree directory');
                    await removeWorktree(fullPath, true);
                    pruned++;
                }
            } catch (err) {
                logger.warn({ fullPath, err }, 'Failed to stat or remove worktree entry during prune');
            }
        }

        const durationMs = Date.now() - startTime;
        logActivityComplete('worktree', 'pruneWorktrees', durationMs, true);
        return { pruned };
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('worktree', 'pruneWorktrees', durationMs, false);
        return { pruned };
    }
}
