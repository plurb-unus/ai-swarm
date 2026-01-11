/**
 * AI Swarm v2 - Gemini CLI Manager
 *
 * File-based async pattern for stable Gemini CLI integration.
 * Uses prompt files and /chat share for response export.
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import { logger } from './logger.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const TASK_DIR = process.env.GEMINI_TASK_DIR || '/tmp/ai-swarm';
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_TIME_MS = 10 * 60 * 1000; // 10 minutes
const CHAT_MAX_AGE_DAYS = parseInt(process.env.CHAT_MAX_AGE_DAYS || '90', 10);

// =============================================================================
// TYPES
// =============================================================================

export interface GeminiTaskResult {
    success: boolean;
    output: string;
    taskId: string;
    durationMs: number;
}

export interface GeminiHealthStatus {
    healthy: boolean;
    version?: string;
    error?: string;
}

// =============================================================================
// TASK DIRECTORY MANAGEMENT
// =============================================================================

/**
 * Create a task directory for a new Gemini invocation.
 */
async function createTaskDir(taskId: string): Promise<string> {
    const taskPath = join(TASK_DIR, taskId);
    // FIX: Set restricted permissions (0700) for task directory to protect prompt files
    await fs.mkdir(taskPath, { recursive: true, mode: 0o700 });
    return taskPath;
}

/**
 * Clean up a task directory after completion.
 */
async function cleanupTaskDir(taskPath: string): Promise<void> {
    try {
        await fs.rm(taskPath, { recursive: true, force: true });
    } catch (error) {
        logger.warn({ taskPath, error }, 'Failed to cleanup task directory');
    }
}

// =============================================================================
// GEMINI CLI INVOCATION
// =============================================================================

/**
 * Invoke Gemini CLI using file-based async pattern.
 *
 * 1. Write prompt to file
 * 2. Spawn gemini with --prompt-file
 * 3. Poll for result file created via /chat share
 * 4. Parse and return result
 */
export async function invokeGeminiAsync(
    prompt: string,
    options: {
        model?: string;
        cwd?: string;
        timeoutMs?: number;
        includeDirs?: string[];
    } = {}
): Promise<GeminiTaskResult> {
    const taskId = `task-${randomUUID()}`;
    const startTime = Date.now();
    const timeout = options.timeoutMs ?? MAX_POLL_TIME_MS;

    logger.info({ taskId, model: options.model }, 'Starting Gemini task');

    try {
        // =======================================================================
        // STEP 1: Build Gemini command
        // =======================================================================
        // Use -o json for structured output and -y for auto-approve
        const args: string[] = [
            '--debug',
            '-y',
            '-o', 'json',
        ];

        if (options.model) {
            args.push('--model', options.model);
        }

        if (options.includeDirs && options.includeDirs.length > 0) {
            options.includeDirs.forEach(dir => {
                args.push('--include-directories', dir);
            });
        }

        // =======================================================================
        // STEP 2: Spawn Gemini CLI and pipe prompt to stdin
        // =======================================================================
        const geminiProcess = spawn('gemini', args, {
            cwd: options.cwd || process.cwd(),
            shell: true,
            env: {
                ...process.env,
                GEMINI_NONINTERACTIVE: '1',
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Write prompt to stdin
        geminiProcess.stdin?.write(prompt);
        geminiProcess.stdin?.end();

        let stdout = '';
        let stderr = '';
        const MAX_BUFFER = 10 * 1024 * 1024; // 10MB limit

        geminiProcess.stdout?.on('data', (data) => {
            if (stdout.length < MAX_BUFFER) stdout += data.toString();
        });

        geminiProcess.stderr?.on('data', (data) => {
            if (stderr.length < MAX_BUFFER) stderr += data.toString();
        });

        // Wait for process to complete
        await new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                geminiProcess.kill('SIGTERM');
                reject(new Error(`Gemini CLI timed out after ${timeout}ms`));
            }, timeout);

            geminiProcess.on('close', (code) => {
                clearTimeout(timeoutId);
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(stderr || `Gemini CLI exited with code: ${code}`));
                }
            });

            geminiProcess.on('error', (error) => {
                clearTimeout(timeoutId);
                reject(new Error(`Failed to spawn Gemini CLI: ${error.message}`));
            });
        });

        // =======================================================================
        // STEP 3: Parse JSON result from stdout
        // =======================================================================
        let finalOutput = '';
        try {
            const rawJson = JSON.parse(stdout);
            // The actual model response is in the 'response' field
            finalOutput = rawJson.response || '';

            // If the response is wrapped in markdown code blocks, strip them
            if (finalOutput.startsWith('```')) {
                finalOutput = finalOutput.replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '');
            }
        } catch (e) {
            logger.warn({ taskId, stdout }, 'Failed to parse JSON result from Gemini CLI stdout');
            finalOutput = stdout; // Fallback to raw stdout
        }

        const durationMs = Date.now() - startTime;
        return {
            success: true,
            output: finalOutput,
            taskId,
            durationMs,
        };
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logger.error({ taskId, error, durationMs }, 'Gemini task failed');

        return {
            success: false,
            output: error instanceof Error ? error.message : String(error),
            taskId,
            durationMs,
        };
    }
}

// =============================================================================
// HEALTH CHECK
// =============================================================================

/**
 * Check if Gemini CLI is accessible and authenticated.
 */
export async function checkGeminiHealth(): Promise<GeminiHealthStatus> {
    try {
        const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            const proc = spawn('gemini', ['--version'], {
                shell: true,
                timeout: 10000,
            });

            let stdout = '';
            let stderr = '';

            proc.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve({ stdout, stderr });
                } else {
                    reject(new Error(stderr || 'Gemini CLI not available'));
                }
            });

            proc.on('error', reject);
        });

        const version = result.stdout.trim();
        return {
            healthy: true,
            version,
        };
    } catch (error) {
        return {
            healthy: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

// =============================================================================
// GARBAGE COLLECTION
// =============================================================================

/**
 * Clean up old task directories and Gemini chat checkpoints.
 */
export async function cleanupOldChats(maxAgeDays: number = CHAT_MAX_AGE_DAYS): Promise<{
    deletedTasks: number;
    deletedChats: number;
}> {
    const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    let deletedTasks = 0;
    let deletedChats = 0;

    // Clean task directories
    try {
        const taskDirs = await fs.readdir(TASK_DIR);
        for (const dir of taskDirs) {
            const dirPath = join(TASK_DIR, dir);
            try {
                const stat = await fs.stat(dirPath);
                if (stat.isDirectory() && stat.mtimeMs < cutoffTime) {
                    await fs.rm(dirPath, { recursive: true, force: true });
                    deletedTasks++;
                }
            } catch {
                // Ignore errors for individual directories
            }
        }
    } catch {
        // Task directory might not exist
    }

    // Clean Gemini chat checkpoints
    const geminiTmpDir = join(process.env.HOME || '', '.gemini', 'tmp');
    try {
        const projectDirs = await fs.readdir(geminiTmpDir);
        for (const projectDir of projectDirs) {
            const projectPath = join(geminiTmpDir, projectDir);
            try {
                const stat = await fs.stat(projectPath);
                if (stat.isDirectory() && stat.mtimeMs < cutoffTime) {
                    await fs.rm(projectPath, { recursive: true, force: true });
                    deletedChats++;
                }
            } catch {
                // Ignore errors
            }
        }
    } catch {
        // Gemini tmp directory might not exist
    }

    logger.info({ deletedTasks, deletedChats, maxAgeDays }, 'Cleanup completed');
    return { deletedTasks, deletedChats };
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    createTaskDir,
    cleanupTaskDir,
    TASK_DIR,
    MAX_POLL_TIME_MS,
};
