/**
 * AI Swarm - Azure DevOps SCM Provider
 * 
 * REST API implementation for Azure DevOps.
 * API Reference: https://learn.microsoft.com/en-us/rest/api/azure/devops/git/
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
    APIRequestOptions,
} from './types.js';
import { apiRequest } from './index.js';
import { logger } from '../logger.js';

const execAsync = promisify(exec);

// Azure DevOps API version
const API_VERSION = '7.0';

/**
 * Azure DevOps REST API provider implementation.
 */
export class AzureDevOpsProvider implements SCMProvider {
    readonly name: SCMProviderType = 'azure-devops';
    readonly config: SCMConfig;
    private repositoryId: string | null = null;

    constructor(config: SCMConfig) {
        if (!config.project) {
            throw new Error('SCM_PROJECT is required for Azure DevOps');
        }
        this.config = config;
    }

    getApiBaseUrl(): string {
        return `https://dev.azure.com/${this.config.org}/${this.config.project}/_apis/git/repositories/${this.config.repo}`;
    }

    getRepoUrl(): string {
        return `https://dev.azure.com/${this.config.org}/${this.config.project}/_git/${this.config.repo}`;
    }

    private getAuthHeader(): Record<string, string> {
        // Azure DevOps uses Basic auth with PAT
        const credentials = Buffer.from(`:${this.config.token}`).toString('base64');
        return {
            'Authorization': `Basic ${credentials}`,
        };
    }

    async configureGitCredentials(projectDir: string): Promise<void> {
        const { org, project, repo, token } = this.config;

        try {
            // Configure git to use token for HTTPS auth
            await execAsync(
                `git config --global url."https://${token}@dev.azure.com/${org}/".insteadOf "https://dev.azure.com/${org}/"`,
                { cwd: projectDir }
            );

            // Also handle the alternate URL format
            await execAsync(
                `git config --global url."https://${token}@dev.azure.com/${org}/".insteadOf "https://${org}@dev.azure.com/${org}/"`,
                { cwd: projectDir }
            );

            // Set origin to point to this Azure DevOps repository
            // This ensures pushes go to the correct remote in multi-project configurations
            const repoUrl = `https://dev.azure.com/${org}/${project}/_git/${repo}`;
            await execAsync(`git remote set-url origin ${repoUrl}`, { cwd: projectDir });

            logger.info({ org, project, repo }, 'Azure DevOps git credentials and origin configured');
        } catch (error) {
            logger.warn({ error }, 'Failed to configure git credentials');
        }
    }

    async createPullRequest(options: CreatePROptions): Promise<string> {
        const { title, description, sourceBranch, targetBranch } = options;

        const body = {
            sourceRefName: `refs/heads/${sourceBranch}`,
            targetRefName: `refs/heads/${targetBranch}`,
            title,
            description,
        };

        const response = await apiRequest<{ pullRequestId: number }>(
            this.getApiBaseUrl(),
            this.getAuthHeader(),
            {
                method: 'POST',
                path: `/pullrequests?api-version=${API_VERSION}`,
                body,
            }
        );

        const prUrl = `${this.getRepoUrl()}/pullrequest/${response.pullRequestId}`;
        logger.info({ prId: response.pullRequestId, prUrl }, 'Azure DevOps PR created');

        return prUrl;
    }

    async getPullRequest(prIdOrUrl: string): Promise<PRInfo> {
        const prId = this.extractPRNumber(prIdOrUrl);

        const response = await apiRequest<{
            pullRequestId: number;
            title: string;
            status: string;
            sourceRefName: string;
            targetRefName: string;
            mergeStatus: string;
            lastMergeCommit?: { commitId: string };
        }>(
            this.getApiBaseUrl(),
            this.getAuthHeader(),
            {
                method: 'GET',
                path: `/pullrequests/${prId}?api-version=${API_VERSION}`,
            }
        );

        // Map Azure DevOps status to our unified status
        let status: 'open' | 'merged' | 'closed';
        if (response.status === 'completed') {
            status = 'merged';
        } else if (response.status === 'abandoned') {
            status = 'closed';
        } else {
            status = 'open';
        }

        return {
            id: response.pullRequestId,
            url: `${this.getRepoUrl()}/pullrequest/${response.pullRequestId}`,
            title: response.title,
            status,
            sourceBranch: response.sourceRefName.replace('refs/heads/', ''),
            targetBranch: response.targetRefName.replace('refs/heads/', ''),
            mergeCommitSha: response.lastMergeCommit?.commitId,
        };
    }

    async mergePullRequest(prIdOrUrl: string, options: MergeOptions = {}): Promise<MergeResult> {
        const prId = this.extractPRNumber(prIdOrUrl);
        const { deleteBranch = true, commitMessage } = options;

        try {
            // First, get the current PR to get the last merge source commit
            const prInfo = await this.getPullRequest(prId);

            // Get the last merge source commit for the completion
            const prDetails = await apiRequest<{
                lastMergeSourceCommit: { commitId: string };
            }>(
                this.getApiBaseUrl(),
                this.getAuthHeader(),
                {
                    method: 'GET',
                    path: `/pullrequests/${prId}?api-version=${API_VERSION}`,
                }
            );

            // Complete (merge) the pull request
            const body: Record<string, unknown> = {
                status: 'completed',
                lastMergeSourceCommit: prDetails.lastMergeSourceCommit,
                completionOptions: {
                    deleteSourceBranch: deleteBranch,
                    mergeStrategy: 'squash',  // Always squash for clean history
                },
            };

            if (commitMessage) {
                (body.completionOptions as Record<string, unknown>).mergeCommitMessage = commitMessage;
            }

            const response = await apiRequest<{
                status: string;
                lastMergeCommit?: { commitId: string };
            }>(
                this.getApiBaseUrl(),
                this.getAuthHeader(),
                {
                    method: 'PATCH',
                    path: `/pullrequests/${prId}?api-version=${API_VERSION}`,
                    body,
                }
            );

            logger.info({ prId, status: response.status }, 'Azure DevOps PR merged');

            return {
                success: true,
                mergeCommitSha: response.lastMergeCommit?.commitId,
                branchDeleted: deleteBranch,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error({ prId, error: errorMessage }, 'Failed to merge PR');

            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    extractPRNumber(prUrl: string): string {
        // Handle both URL and direct ID
        if (/^\d+$/.test(prUrl)) {
            return prUrl;
        }

        // Azure DevOps URL format: .../pullrequest/{id}
        const match = prUrl.match(/\/pullrequest\/(\d+)/);
        if (match) {
            return match[1];
        }

        throw new Error(`Could not extract PR number from: ${prUrl}`);
    }
}
