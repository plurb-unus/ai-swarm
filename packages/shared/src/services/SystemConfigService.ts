/**
 * AI Swarm v3.0.0 - System Config Service
 * 
 * Database-backed system configuration for runtime settings.
 * Follows the same pattern as WorkerHealthService.
 */

import { logger } from '../logger.js';
import { getPool } from '../db.js';

export type ClaudeAuthMode = 'oauth' | 'zai';
export type LLMRole = 'planner' | 'coder' | 'reviewer' | 'portal_planner' | 'deployer';

// Use string literals instead of importing to avoid circular dependency
type LLMProvider = 'gemini' | 'claude';

const LLM_ROLE_DEFAULTS: Record<LLMRole, LLMProvider> = {
    planner: 'gemini',
    coder: 'claude',
    reviewer: 'gemini',
    portal_planner: 'gemini',
    deployer: 'gemini',
};

export interface EmailConfig {
    provider: string;
    apiKey: string;
    from: string;
    to: string;
}

export interface TestCredentials {
    email: string;
    password: string;
}

export class SystemConfigService {
    /**
     * Get a configuration value by key
     */
    async getConfig(key: string): Promise<string | null> {
        try {
            const pool = getPool();
            const result = await pool.query(
                `SELECT value FROM system_config WHERE key = $1`,
                [key]
            );
            if (result.rows.length > 0) {
                return result.rows[0].value;
            }
        } catch (err) {
            logger.warn({ err, key }, 'Failed to get config from DB');
        }
        return null;
    }

    /**
     * Set a configuration value by key
     */
    async setConfig(key: string, value: string, isSecret: boolean = false): Promise<void> {
        const pool = getPool();
        await pool.query(
            `INSERT INTO system_config (key, value, is_secret, updated_at) 
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $2, is_secret = $3, updated_at = NOW()`,
            [key, value, isSecret]
        );
        logger.info({ key }, 'System config updated');
    }

    /**
     * Get a resolved configuration value (DB first, then ENV)
     */
    async getResolvedConfig(key: string): Promise<string> {
        const dbValue = await this.getConfig(key);
        if (dbValue) return dbValue;

        // Map key to ENV var naming convention
        const envKey = key.toUpperCase();

        // Special mappings for keys that don't match ENV exactly
        const specialMappings: Record<string, string> = {
            'scm_token_azure_devops': 'SCM_TOKEN',
            'scm_token_github': 'SCM_TOKEN',
            'scm_token_gitlab': 'SCM_TOKEN',
            'default_project_dir': 'PROJECT_DIR',
            'test_user_email': 'TEST_USER_EMAIL',
            'test_user_password': 'TEST_USER_PASSWORD',
            'email_api_key': 'EMAIL_API_KEY',
            'email_provider': 'EMAIL_PROVIDER',
            'email_from': 'EMAIL_FROM',
            'email_to': 'EMAIL_TO',
            'z_ai_api_key': 'Z_AI_API_KEY',
        };

        const finalEnvKey = specialMappings[key] || envKey;
        return process.env[finalEnvKey] || '';
    }

    /**
     * Get Claude authentication mode
     * Falls back to env var, then defaults to 'oauth'
     */
    async getClaudeAuthMode(): Promise<ClaudeAuthMode> {
        const dbValue = await this.getConfig('claude_auth_mode');
        if (dbValue === 'zai' || dbValue === 'oauth') {
            return dbValue;
        }
        // Fallback to env var
        const envValue = process.env.CLAUDE_AUTH_MODE;
        if (envValue === 'zai' || envValue === 'oauth') {
            return envValue;
        }
        // Default to oauth (Pro/Max subscription)
        return 'oauth';
    }

    /**
     * Set Claude authentication mode
     */
    async setClaudeAuthMode(mode: ClaudeAuthMode): Promise<void> {
        await this.setConfig('claude_auth_mode', mode);
    }

    /**
     * Get Z.ai API key
     * Falls back to env var Z_AI_API_KEY
     */
    async getZaiApiKey(): Promise<string> {
        const dbValue = await this.getConfig('z_ai_api_key');
        if (dbValue) return dbValue;
        return process.env.Z_AI_API_KEY || '';
    }

    /**
     * Get SCM token for a specific provider (fallback for projects without their own token)
     * Hierarchy: DB per-provider token → ENV SCM_TOKEN
     */
    async getScmTokenForProvider(provider: 'azure-devops' | 'github' | 'gitlab'): Promise<string> {
        const keyMap: Record<string, string> = {
            'azure-devops': 'scm_token_azure_devops',
            'github': 'scm_token_github',
            'gitlab': 'scm_token_gitlab',
        };
        const key = keyMap[provider];
        if (key) {
            const dbValue = await this.getConfig(key);
            if (dbValue) return dbValue;
        }
        // Legacy fallback to single SCM_TOKEN env var
        return process.env.SCM_TOKEN || '';
    }

    /**
     * Get default project directory
     */
    async getDefaultProjectDir(): Promise<string> {
        const dbValue = await this.getConfig('default_project_dir');
        if (dbValue) return dbValue;
        return process.env.PROJECT_DIR || '/project';
    }

    /**
     * Get workspace root directory (contains all projects)
     * v3.0.0: Multi-project support - all projects are subdirectories of this root
     */
    async getWorkspaceRoot(): Promise<string> {
        const dbValue = await this.getConfig('workspace_root');
        if (dbValue) return dbValue;
        return process.env.WORKSPACE_ROOT || '/apps';
    }

    /**
     * Resolve a project's full path from workspace root and project base_path
     * v3.0.0: Used by workflows and activities to locate project directories
     */
    async resolveProjectPath(projectBasePath: string): Promise<string> {
        // If path is already absolute, return as-is
        if (projectBasePath.startsWith('/')) {
            return projectBasePath;
        }
        // Otherwise, prepend workspace root
        const workspaceRoot = await this.getWorkspaceRoot();
        return `${workspaceRoot}/${projectBasePath}`;
    }

    /**
     * Get log level
     */
    async getLogLevel(): Promise<string> {
        const dbValue = await this.getConfig('log_level');
        if (dbValue) return dbValue;
        return process.env.LOG_LEVEL || 'info';
    }

    /**
     * Get email configuration
     */
    async getEmailConfig(): Promise<EmailConfig> {
        const [provider, apiKey, from, to] = await Promise.all([
            this.getConfig('email_provider'),
            this.getConfig('email_api_key'),
            this.getConfig('email_from'),
            this.getConfig('email_to'),
        ]);
        return {
            provider: provider || process.env.EMAIL_PROVIDER || 'resend',
            apiKey: apiKey || process.env.EMAIL_API_KEY || '',
            from: from || process.env.EMAIL_FROM || 'noreply@example.com',
            to: to || process.env.EMAIL_TO || '',
        };
    }

    /**
     * Get worker count
     */
    async getWorkerCount(): Promise<number> {
        const dbValue = await this.getConfig('worker_count');
        if (dbValue) return parseInt(dbValue, 10);
        return parseInt(process.env.WORKER_COUNT || '4', 10);
    }

    /**
     * Get Playwright test credentials
     */
    async getTestCredentials(): Promise<TestCredentials> {
        const [email, password] = await Promise.all([
            this.getConfig('test_user_email'),
            this.getConfig('test_user_password'),
        ]);
        return {
            email: email || process.env.TEST_USER_EMAIL || '',
            password: password || process.env.TEST_USER_PASSWORD || '',
        };
    }

    /**
     * Get LLM provider for a specific role
     * Falls back to env var (LLM_PLANNER, LLM_CODER, etc), then defaults
     */
    async getLLMRole(role: LLMRole): Promise<LLMProvider> {
        const key = `llm_${role}`;
        const dbValue = await this.getConfig(key);
        if (dbValue === 'gemini' || dbValue === 'claude') {
            return dbValue;
        }
        // Fallback to env var
        const envKey = `LLM_${role.toUpperCase()}`;
        const envValue = process.env[envKey];
        if (envValue === 'gemini' || envValue === 'claude') {
            return envValue;
        }
        // Return default
        return LLM_ROLE_DEFAULTS[role];
    }

    /**
     * Set LLM provider for a specific role
     */
    async setLLMRole(role: LLMRole, provider: LLMProvider): Promise<void> {
        const key = `llm_${role}`;
        await this.setConfig(key, provider);
    }

    /**
     * Get all LLM role configurations
     */
    async getAllLLMRoles(): Promise<Record<LLMRole, LLMProvider>> {
        const roles: LLMRole[] = ['planner', 'coder', 'reviewer', 'portal_planner', 'deployer'];
        const result = {} as Record<LLMRole, LLMProvider>;
        for (const role of roles) {
            result[role] = await this.getLLMRole(role);
        }
        return result;
    }

    /**
     * Get deployer container blacklist (comma-separated container names)
     * These containers are protected from LLM Deployer actions
     */
    async getDeployerBlacklist(): Promise<string[]> {
        const dbValue = await this.getConfig('deployer_blacklist');
        if (dbValue) {
            return dbValue.split(',').map(s => s.trim()).filter(Boolean);
        }
        // Default blacklist includes AI Swarm infrastructure
        return [
            'temporal-server', 'postgres', 'redis', 'traefik', 'portainer',
            'ai-swarm-portal', 'ai-swarm-worker-1', 'ai-swarm-worker-2',
            'ai-swarm-worker-3', 'ai-swarm-worker-4', 'ai-swarm-playwright', 'ai-swarm-builder'
        ];
    }

    /**
     * Set deployer container blacklist
     */
    async setDeployerBlacklist(containers: string[]): Promise<void> {
        const value = containers.join(',');
        await this.setConfig('deployer_blacklist', value);
    }
    /**
     * Get chat retention period in days
     */
    async getChatMaxAgeDays(): Promise<number> {
        const dbValue = await this.getConfig('chat_max_age_days');
        if (dbValue) return parseInt(dbValue, 10);
        return parseInt(process.env.CHAT_MAX_AGE_DAYS || '90', 10);
    }
}

export const systemConfigService = new SystemConfigService();
