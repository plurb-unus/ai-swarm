/**
 * AI Swarm - GitLab SCM Provider
 * 
 * REST API implementation for GitLab.
 * API Reference: https://docs.gitlab.com/ee/api/merge_requests.html
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
 * GitLab REST API provider implementation.
 */
export class GitLabProvider implements SCMProvider {
    readonly name: SCMProviderType = 'gitlab';
    readonly config: SCMConfig;
    private projectId: string;

    constructor(config: SCMConfig) {
        this.config = config;
        // GitLab project ID is URL-encoded path: group/repo -> group%2Frepo
        this.projectId = encodeURIComponent(`${config.org}/${config.repo}`);
    }

    getApiBaseUrl(): string {
        return 'https://gitlab.com/api/v4';
    }

    getRepoUrl(): string {
        return `https://gitlab.com/${this.config.org}/${this.config.repo}`;
    }

    private getAuthHeader(): Record<string, string> {
        return {
            'PRIVATE-TOKEN': this.config.token,
        };
    }

    async configureGitCredentials(projectDir: string): Promise<void> {
        const { token, org, repo } = this.config;

        try {
            // Configure URL rewriting for authentication
            await execAsync(
                `git config --global url."https://oauth2:${token}@gitlab.com/".insteadOf "https://gitlab.com/"`,
                { cwd: projectDir }
            );

            // Set origin to point to this GitLab repository
            // This ensures pushes go to the correct remote in multi-project configurations
            const repoUrl = `https://gitlab.com/${org}/${repo}.git`;
            await execAsync(`git remote set-url origin ${repoUrl}`, { cwd: projectDir });

            logger.info({ org, repo }, 'GitLab git credentials and origin configured');
        } catch (error) {
            logger.warn({ error }, 'Failed to configure git credentials');
        }
    }

    async createPullRequest(options: CreatePROptions): Promise<string> {
        const { title, description, sourceBranch, targetBranch, squashMerge, deleteSourceBranch } = options;

        const body = {
            source_branch: sourceBranch,
            target_branch: targetBranch,
            title,
            description,
            squash: squashMerge ?? true,
            remove_source_branch: deleteSourceBranch ?? true,
        };

        const response = await apiRequest<{ iid: number; web_url: string }>(
            this.getApiBaseUrl(),
            this.getAuthHeader(),
            {
                method: 'POST',
                path: `/projects/${this.projectId}/merge_requests`,
                body,
            }
        );

        logger.info({ mrIid: response.iid, mrUrl: response.web_url }, 'GitLab MR created');

        return response.web_url;
    }

    async getPullRequest(prIdOrUrl: string): Promise<PRInfo> {
        const mrIid = this.extractPRNumber(prIdOrUrl);

        const response = await apiRequest<{
            iid: number;
            web_url: string;
            title: string;
            state: string;
            source_branch: string;
            target_branch: string;
            merge_commit_sha?: string;
        }>(
            this.getApiBaseUrl(),
            this.getAuthHeader(),
            {
                method: 'GET',
                path: `/projects/${this.projectId}/merge_requests/${mrIid}`,
            }
        );

        let status: 'open' | 'merged' | 'closed';
        if (response.state === 'merged') {
            status = 'merged';
        } else if (response.state === 'closed') {
            status = 'closed';
        } else {
            status = 'open';
        }

        return {
            id: response.iid,
            url: response.web_url,
            title: response.title,
            status,
            sourceBranch: response.source_branch,
            targetBranch: response.target_branch,
            mergeCommitSha: response.merge_commit_sha,
        };
    }

    async mergePullRequest(prIdOrUrl: string, options: MergeOptions = {}): Promise<MergeResult> {
        const mrIid = this.extractPRNumber(prIdOrUrl);
        const { deleteBranch = true, commitMessage } = options;

        try {
            const body: Record<string, unknown> = {
                squash: true,
                should_remove_source_branch: deleteBranch,
            };

            if (commitMessage) {
                body.merge_commit_message = commitMessage;
            }

            const response = await apiRequest<{
                state: string;
                merge_commit_sha?: string;
            }>(
                this.getApiBaseUrl(),
                this.getAuthHeader(),
                {
                    method: 'PUT',
                    path: `/projects/${this.projectId}/merge_requests/${mrIid}/merge`,
                    body,
                }
            );

            logger.info({ mrIid, state: response.state }, 'GitLab MR merged');

            return {
                success: true,
                mergeCommitSha: response.merge_commit_sha,
                branchDeleted: deleteBranch,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error({ mrIid, error: errorMessage }, 'Failed to merge MR');

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

        // GitLab URL format: .../merge_requests/{iid} or .../-/merge_requests/{iid}
        const match = prUrl.match(/\/(?:-\/)?merge_requests\/(\d+)/);
        if (match) {
            return match[1];
        }

        throw new Error(`Could not extract MR number from: ${prUrl}`);
    }
}
