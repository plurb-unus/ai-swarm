/**
 * AI Swarm - SCM Provider Factory
 * 
 * Factory function to get the appropriate SCM provider based on configuration.
 */

import { SCMProvider, SCMConfig, SCMProviderType, APIRequestOptions } from './types.js';
import { AzureDevOpsProvider } from './azure-devops.js';
import { GitLabProvider } from './gitlab.js';
import { GitHubProvider } from './github.js';
import { logger } from '../logger.js';

export * from './types.js';
export { AzureDevOpsProvider } from './azure-devops.js';
export { GitLabProvider } from './gitlab.js';
export { GitHubProvider } from './github.js';

/**
 * Get SCM configuration from environment variables.
 */
export function getSCMConfigFromEnv(): SCMConfig {
    const provider = (process.env.SCM_PROVIDER || 'azure-devops') as SCMProviderType;
    const token = process.env.SCM_TOKEN || '';
    const org = process.env.SCM_ORG || '';
    const project = process.env.SCM_PROJECT || '';
    const repo = process.env.SCM_REPO || '';

    if (!token) {
        throw new Error('SCM_TOKEN environment variable is required');
    }
    if (!org) {
        throw new Error('SCM_ORG environment variable is required');
    }
    if (!repo) {
        throw new Error('SCM_REPO environment variable is required');
    }
    if (provider === 'azure-devops' && !project) {
        throw new Error('SCM_PROJECT environment variable is required for Azure DevOps');
    }

    return { provider, token, org, project, repo };
}

/**
 * Get the appropriate SCM provider based on environment configuration.
 */
export function getSCMProvider(config?: SCMConfig): SCMProvider {
    const cfg = config || getSCMConfigFromEnv();

    logger.info({ provider: cfg.provider, org: cfg.org, repo: cfg.repo }, 'Initializing SCM provider');

    switch (cfg.provider) {
        case 'azure-devops':
            return new AzureDevOpsProvider(cfg);
        case 'gitlab':
            return new GitLabProvider(cfg);
        case 'github':
            return new GitHubProvider(cfg);
        default:
            throw new Error(`Unsupported SCM provider: ${cfg.provider}`);
    }
}

/**
 * Get SCM config with proper token fallback hierarchy:
 * 1. Per-Project Token (from project database)
 * 2. Per-Provider Token (from system_config database)
 * 3. Environment Variable (SCM_TOKEN)
 * 
 * This async function should be used when projectId is available.
 */
export async function getSCMConfigWithFallback(
    projectId?: string,
    projectConfig?: { scmProvider?: string; scmOrg?: string; scmProject?: string; scmRepo?: string; scmToken?: string }
): Promise<SCMConfig | null> {
    // Dynamic import to avoid circular dependency
    const { systemConfigService } = await import('../services/SystemConfigService.js');
    const { projectService } = await import('../services/ProjectService.js');

    // Try to get project config if not provided
    let config = projectConfig;
    if (!config && projectId) {
        try {
            config = await projectService.getProjectById(projectId);
        } catch (err) {
            logger.warn({ err, projectId }, 'Failed to get project config');
        }
    }

    if (!config?.scmProvider || !config?.scmOrg || !config?.scmRepo) {
        logger.warn({ projectId }, 'Missing required SCM config (provider, org, repo)');
        return null;
    }

    const provider = config.scmProvider as SCMProviderType;

    // Token fallback hierarchy:
    // 1. Per-project token
    let token = config.scmToken || '';

    // 2. Per-provider token from system config
    if (!token) {
        token = await systemConfigService.getScmTokenForProvider(provider);
    }

    // 3. Environment variable (handled inside getScmTokenForProvider)

    if (!token) {
        logger.warn({ projectId, provider }, 'No SCM token found in hierarchy');
        return null;
    }

    return {
        provider,
        token,
        org: config.scmOrg,
        project: config.scmProject || '',
        repo: config.scmRepo,
    };
}

/**
 * Base HTTP client with retry logic and rate limiting.
 * Used by all provider implementations.
 */
export async function apiRequest<T>(
    baseUrl: string,
    authHeader: Record<string, string>,
    options: APIRequestOptions
): Promise<T> {
    const { method, path, body, headers = {}, maxRetries = 3 } = options;
    const url = `${baseUrl}${path}`;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeader,
                    ...headers,
                },
                body: body ? JSON.stringify(body) : undefined,
            });

            // Handle rate limiting (429)
            if (response.status === 429) {
                const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
                logger.warn({ url, attempt, retryAfter }, 'Rate limited, waiting...');
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                continue;
            }

            // Handle server errors with retry
            if (response.status >= 500 && attempt < maxRetries) {
                const backoff = Math.pow(2, attempt) * 1000;
                logger.warn({ url, status: response.status, attempt, backoff }, 'Server error, retrying...');
                await new Promise(resolve => setTimeout(resolve, backoff));
                continue;
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
            }

            // Handle empty responses
            const text = await response.text();
            if (!text) {
                return {} as T;
            }

            return JSON.parse(text) as T;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            if (attempt < maxRetries) {
                const backoff = Math.pow(2, attempt) * 1000;
                logger.warn({ url, error: lastError.message, attempt, backoff }, 'Request failed, retrying...');
                await new Promise(resolve => setTimeout(resolve, backoff));
            }
        }
    }

    throw lastError || new Error('API request failed after all retries');
}
