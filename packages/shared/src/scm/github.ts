/**
 * AI Swarm - GitHub SCM Provider
 * 
 * REST API implementation for GitHub.
 * API Reference: https://docs.github.com/en/rest/pulls
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import {
    SCMProvider,
    SCMConfig,
    SCMProviderType,
    CreatePROptions,
    PRInfo,
    MergeOptions,
    MergeResult,
} from './types.js';
import { apiRequest } from './index.js';
import { logger } from '../logger.js';

const execAsync = promisify(exec);

/**
 * GitHub REST API provider implementation.
 */
export class GitHubProvider implements SCMProvider {
    readonly name: SCMProviderType = 'github';
    readonly config: SCMConfig;

    constructor(config: SCMConfig) {
        this.config = config;
    }

    getApiBaseUrl(): string {
        return 'https://api.github.com';
    }

    getRepoUrl(): string {
        return `https://github.com/${this.config.org}/${this.config.repo}`;
    }

    private getAuthHeader(): Record<string, string> {
        return {
            'Authorization': `Bearer ${this.config.token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        };
    }

    async configureGitCredentials(projectDir: string): Promise<void> {
        const { token, org, repo } = this.config;

        try {
            // Configure URL rewriting for authentication
            await execAsync(
                `git config --global url."https://${token}@github.com/".insteadOf "https://github.com/"`,
                { cwd: projectDir }
            );

            // Also set the origin remote to point to this GitHub repository
            // This ensures pushes go to the correct remote when using multi-project configurations
            const repoUrl = `https://github.com/${org}/${repo}.git`;
            await execAsync(`git remote set-url origin ${repoUrl}`, { cwd: projectDir });

            logger.info({ org, repo }, 'GitHub git credentials and origin configured');
        } catch (error) {
            logger.warn({ error }, 'Failed to configure git credentials');
        }
    }

    async createPullRequest(options: CreatePROptions): Promise<string> {
        const { title, description, sourceBranch, targetBranch } = options;
        const { org, repo } = this.config;

        const body = {
            head: sourceBranch,
            base: targetBranch,
            title,
            body: description,
        };

        const response = await apiRequest<{ number: number; html_url: string }>(
            this.getApiBaseUrl(),
            this.getAuthHeader(),
            {
                method: 'POST',
                path: `/repos/${org}/${repo}/pulls`,
                body,
            }
        );

        logger.info({ prNumber: response.number, prUrl: response.html_url }, 'GitHub PR created');

        return response.html_url;
    }

    async getPullRequest(prIdOrUrl: string): Promise<PRInfo> {
        const prNumber = this.extractPRNumber(prIdOrUrl);
        const { org, repo } = this.config;

        const response = await apiRequest<{
            number: number;
            html_url: string;
            title: string;
            state: string;
            merged: boolean;
            head: { ref: string };
            base: { ref: string };
            merge_commit_sha?: string;
        }>(
            this.getApiBaseUrl(),
            this.getAuthHeader(),
            {
                method: 'GET',
                path: `/repos/${org}/${repo}/pulls/${prNumber}`,
            }
        );

        let status: 'open' | 'merged' | 'closed';
        if (response.merged) {
            status = 'merged';
        } else if (response.state === 'closed') {
            status = 'closed';
        } else {
            status = 'open';
        }

        return {
            id: response.number,
            url: response.html_url,
            title: response.title,
            status,
            sourceBranch: response.head.ref,
            targetBranch: response.base.ref,
            mergeCommitSha: response.merge_commit_sha,
        };
    }

    async mergePullRequest(prIdOrUrl: string, options: MergeOptions = {}): Promise<MergeResult> {
        const prNumber = this.extractPRNumber(prIdOrUrl);
        const { org, repo } = this.config;
        const { deleteBranch = true, mergeMethod = 'squash', commitMessage } = options;

        try {
            const body: Record<string, unknown> = {
                merge_method: mergeMethod,
            };

            if (commitMessage) {
                body.commit_message = commitMessage;
            }

            const response = await apiRequest<{
                merged: boolean;
                sha: string;
            }>(
                this.getApiBaseUrl(),
                this.getAuthHeader(),
                {
                    method: 'PUT',
                    path: `/repos/${org}/${repo}/pulls/${prNumber}/merge`,
                    body,
                }
            );

            // Delete branch if requested
            if (deleteBranch && response.merged) {
                const prInfo = await this.getPullRequest(prNumber);
                try {
                    await apiRequest<void>(
                        this.getApiBaseUrl(),
                        this.getAuthHeader(),
                        {
                            method: 'DELETE',
                            path: `/repos/${org}/${repo}/git/refs/heads/${prInfo.sourceBranch}`,
                        }
                    );
                } catch (deleteError) {
                    logger.warn({ branch: prInfo.sourceBranch }, 'Failed to delete source branch');
                }
            }

            logger.info({ prNumber, merged: response.merged }, 'GitHub PR merged');

            return {
                success: true,
                mergeCommitSha: response.sha,
                branchDeleted: deleteBranch,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error({ prNumber, error: errorMessage }, 'Failed to merge PR');

            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    extractPRNumber(prUrl: string): string {
        if (/^\d+$/.test(prUrl)) {
            return prUrl;
        }

        // GitHub URL format: .../pull/{number}
        const match = prUrl.match(/\/pull\/(\d+)/);
        if (match) {
            return match[1];
        }

        throw new Error(`Could not extract PR number from: ${prUrl}`);
    }
}
