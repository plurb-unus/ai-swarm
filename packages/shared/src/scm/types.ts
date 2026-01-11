/**
 * AI Swarm - SCM Provider Types
 * 
 * Unified interface for source control management providers.
 * Supports GitLab, Azure DevOps, and GitHub.
 */

export type SCMProviderType = 'gitlab' | 'azure-devops' | 'github';

/**
 * Configuration for SCM provider initialization.
 */
export interface SCMConfig {
    provider: SCMProviderType;
    token: string;
    org: string;
    project?: string;  // Required for Azure DevOps, optional for others
    repo: string;
}

/**
 * Options for creating a pull request.
 */
export interface CreatePROptions {
    title: string;
    description: string;
    sourceBranch: string;
    targetBranch: string;
    squashMerge?: boolean;
    deleteSourceBranch?: boolean;
}

/**
 * Information about a pull request.
 */
export interface PRInfo {
    id: string | number;
    url: string;
    title: string;
    status: 'open' | 'merged' | 'closed';
    sourceBranch: string;
    targetBranch: string;
    mergeCommitSha?: string;
}

/**
 * Options for merging a pull request.
 */
export interface MergeOptions {
    mergeMethod?: 'squash' | 'merge' | 'rebase';
    deleteBranch?: boolean;
    commitMessage?: string;
}

/**
 * Result of a merge operation.
 */
export interface MergeResult {
    success: boolean;
    mergeCommitSha?: string;
    branchDeleted?: boolean;
    error?: string;
}

/**
 * Abstract SCM Provider interface.
 * All provider implementations must implement this interface.
 */
export interface SCMProvider {
    readonly name: SCMProviderType;
    readonly config: SCMConfig;

    /**
     * Configure git credentials for HTTPS authentication.
     * Sets up the insteadOf URL rewriting for the provider.
     */
    configureGitCredentials(projectDir: string): Promise<void>;

    /**
     * Create a pull/merge request.
     * @returns The URL of the created PR/MR
     */
    createPullRequest(options: CreatePROptions): Promise<string>;

    /**
     * Get information about a pull request.
     */
    getPullRequest(prIdOrUrl: string): Promise<PRInfo>;

    /**
     * Merge a pull request.
     */
    mergePullRequest(prIdOrUrl: string, options?: MergeOptions): Promise<MergeResult>;

    /**
     * Extract PR/MR number from URL.
     */
    extractPRNumber(prUrl: string): string;

    /**
     * Get the full repository URL.
     */
    getRepoUrl(): string;

    /**
     * Get the API base URL for this provider.
     */
    getApiBaseUrl(): string;
}

/**
 * HTTP request options with retry and rate limiting.
 */
export interface APIRequestOptions {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
    maxRetries?: number;
}
