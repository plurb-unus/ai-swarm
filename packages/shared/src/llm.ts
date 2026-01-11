/**
 * AI Swarm v3.0.0 - LLM Wrapper
 *
 * Invokes LLMs (Gemini CLI or Claude Code) with model cascade and retry logic.
 * Supports per-role provider selection via LLM_* environment variables.
 */

import { AgentRole } from './types.js';
import { logger } from './logger.js';
import { invokeGeminiAsync } from './gemini-manager.js';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { promptService } from './services/PromptService.js';
import { getContextFolderPath } from './context-discovery.js';

const execAsync = promisify(exec);

// =============================================================================
// PER-ROLE LLM PROVIDER SELECTION (v3.0.0)
// =============================================================================

export type LLMProvider = 'claude' | 'gemini';
export type WorkflowRole = 'planner' | 'coder' | 'reviewer';

/**
 * Get the configured LLM provider for a specific role.
 * Falls back to Gemini if Claude is configured but unavailable.
 */
export function getLLMForRole(role: WorkflowRole): LLMProvider {
    const envKey = `LLM_${role.toUpperCase()}`;
    const configured = process.env[envKey] as LLMProvider | undefined;

    // Default values if not configured
    const defaults: Record<WorkflowRole, LLMProvider> = {
        planner: 'gemini',
        coder: 'claude',
        reviewer: 'gemini',
    };

    const provider = configured || defaults[role];

    // Validate Claude availability
    if (provider === 'claude' && !process.env.Z_AI_API_KEY) {
        logger.warn(
            { role, envKey },
            'Claude requested but Z_AI_API_KEY not set, falling back to Gemini'
        );
        return 'gemini';
    }

    return provider;
}

// =============================================================================
// MODEL CASCADES BY ROLE
// =============================================================================

const MODEL_CASCADE: Record<AgentRole, string[]> = {
    // Portal Planner: Chat interface on Submit page, use Flash for speed
    portal_planner: ['gemini-2.5-flash', 'gemini-2.5-pro'],

    // Planner: Use Pro for best reasoning, fallback to Flash if Pro quota exhausted
    planner: ['gemini-2.5-pro', 'gemini-2.5-flash'],

    // Coder: Use Flash for speed, fallback to Pro for complex code
    coder: ['gemini-2.5-flash', 'gemini-2.5-pro'],

    // Deployer: LLM-powered deployment orchestration, Flash for speed, Pro for complex troubleshooting
    deployer: ['gemini-2.5-flash', 'gemini-2.5-pro'],

    // Supervisor: Simple monitoring tasks, Flash is sufficient
    supervisor: ['gemini-2.5-flash'],

    // Reviewer: Deep logic checks, use Pro
    reviewer: ['gemini-2.5-pro', 'gemini-2.5-flash'],
};

// Timeout per model attempt (10 minutes)
const MODEL_TIMEOUT_MS = 10 * 60 * 1000;

// Delay between retries
const RETRY_DELAY_MS = 2000;

// =============================================================================
// GEMINI CLI INVOCATION
// =============================================================================

export interface GeminiOptions {
    role: AgentRole;
    cwd?: string;
    timeout?: number;
    systemPrompt?: string;
}

/**
 * Invoke Gemini CLI with automatic model cascade on failure.
 * Uses file-based async pattern for stability.
 */
export async function invokeGeminiCLI(
    prompt: string,
    options: GeminiOptions
): Promise<string> {
    const models = MODEL_CASCADE[options.role];
    const timeout = options.timeout ?? MODEL_TIMEOUT_MS;

    for (let i = 0; i < models.length; i++) {
        const model = models[models.length - 1 - i]; // Try models in reverse order (Pro first for specific roles)
        // Wait, MODEL_CASCADE for coder has Flash first. 
        // Let's actually follow the array order or define it more explicitly.
        // Actually, the original code used models[i]. I'll stick to that but ensure roles that need Pro have Pro first.

        const currentModel = models[i];

        try {
            logger.info({ model: currentModel, role: options.role }, `Attempting with model: ${currentModel}`);

            // Use context discovery to find include directories
            const includeDirs: string[] = [];
            if (options.cwd) {
                const contextPath = await getContextFolderPath(options.cwd);
                if (contextPath) {
                    includeDirs.push(contextPath);
                }
            }

            const result = await invokeGeminiAsync(prompt, {
                model: currentModel,
                cwd: options.cwd,
                timeoutMs: timeout,
                includeDirs: includeDirs.length > 0 ? includeDirs : undefined,
            });

            if (result.success) {
                logger.info({ model: currentModel, durationMs: result.durationMs }, `Success with model: ${currentModel}`);
                return result.output;
            } else {
                throw new Error(result.output);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn({ model: currentModel, error: errorMessage }, `Failed with ${currentModel}`);

            if (i < models.length - 1) {
                await sleep(RETRY_DELAY_MS);
            }
        }
    }

    throw new Error(`All models in cascade exhausted for role: ${options.role}`);
}

/**
 * NEW: Unified entry point for LLM invocation with backend selection.
 */
/**
 * NEW: Unified entry point for LLM invocation with backend selection.
 * v3.0.0: Now database-aware using SystemConfigService.
 */
export async function invokeLLM(
    prompt: string,
    options: GeminiOptions & { useClaudeIfAvailable?: boolean }
): Promise<string> {
    const { systemConfigService } = await import('./services/SystemConfigService.js');

    // 1. Determine Provider
    let provider: LLMProvider = 'gemini';

    // Legacy override support (deprecated but kept for backward compat)
    if (options.useClaudeIfAvailable && process.env.Z_AI_API_KEY) {
        provider = 'claude';
    } else {
        // Fetch from DB (or fallback to ENV via service)
        provider = await systemConfigService.getLLMRole(options.role as any);
    }

    if (provider === 'claude') {
        try {
            logger.info({ role: options.role }, 'Attempting to use Claude Code');

            // 2. Check Auth Mode
            const authMode = await systemConfigService.getClaudeAuthMode();
            const zAiKey = await systemConfigService.getZaiApiKey();

            // Prepare Env
            const env = { ...process.env };

            if (authMode === 'zai') {
                if (!zAiKey) {
                    throw new Error('Claude selected with Z.ai mode but no API key found');
                }
                env.Z_AI_API_KEY = zAiKey;
                logger.debug('Using Claude with Z.ai API Key');
            } else {
                // OAuth mode: Ensure Z_AI_API_KEY is NOT set to avoid conflict
                delete env.Z_AI_API_KEY;
                logger.debug('Using Claude with OAuth (Pro/Max)');
            }

            // 3. Invoke CLI
            // Use -p (--print) flag for non-interactive output per CLAUDE_CLI.md
            // Pipe prompt via stdin to avoid shell escaping issues with long prompts
            const { execSync } = await import('child_process');
            const result = execSync('claude -p', {
                cwd: options.cwd,
                env: env,
                input: prompt,
                encoding: 'utf-8',
                maxBuffer: 50 * 1024 * 1024, // 50MB buffer
            });
            return result;
        } catch (error) {
            logger.warn({ error, role: options.role }, 'Claude Code failed, falling back to Gemini');
            // Fallthrough to Gemini
        }
    }

    return invokeGeminiCLI(prompt, options);
}




// =============================================================================
// UTILITIES
// =============================================================================

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load system prompt from database. Throws if DB is unavailable or prompt not found.
 * v3.0.0: Removed fallback to hardcoded prompts - fail fast if DB is down.
 */
export async function loadSystemPrompt(role: AgentRole): Promise<string> {
    try {
        return await promptService.getActivePrompt(role);
    } catch (err) {
        logger.error({ role, err }, 'Failed to load prompt from DB - no fallback available');
        throw new Error(`Prompt '${role}' could not be loaded from database. Ensure DB is running and prompts are seeded.`);
    }
}

// v3.0.0: Hardcoded prompts removed. All prompts are now loaded from the database.
// See packages/shared/prompts/*.md for the source files that are seeded to the DB.
