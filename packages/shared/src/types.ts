/**
 * AI Swarm v2 - Core Type Definitions
 */

// =============================================================================
// TASK TYPES
// =============================================================================

export interface Task {
    id: string;
    title: string;
    context: string;
    acceptanceCriteria: string[];
    filesToModify: string[];
    priority: TaskPriority;
    createdAt: Date;
    type?: 'feature' | 'bugfix' | 'refactor' | 'docs';  // Task type for branch naming
    metadata?: Record<string, unknown>;
    projectId?: string;  // v3.0.0: Project association for multi-project support
}

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

// =============================================================================
// IMPLEMENTATION PLAN
// =============================================================================

export interface ImplementationPlan {
    taskId: string;
    proposedChanges: FileChange[];
    verificationPlan: string;
    estimatedEffort: string;
    dependencies?: string[];
    context?: string;  // Additional context for the task implementation
    projectId?: string;  // v3.0.0: Project ID for SCM credential lookup
}

export interface FileChange {
    path: string;
    action: 'create' | 'modify' | 'delete';
    description: string;
}

// =============================================================================
// AGENT TYPES
// =============================================================================

export type AgentRole = 'planner' | 'coder' | 'deployer' | 'supervisor' | 'reviewer' | 'portal_planner';

export interface AgentResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    logs: LogEntry[];
    durationMs: number;
}

export interface LogEntry {
    timestamp: Date;
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    metadata?: Record<string, unknown>;
}

// =============================================================================
// WORKFLOW TYPES
// =============================================================================

export interface WorkflowInput {
    task: Task;
    projectId: string;  // v3.0.0: Required project context for multi-project support
    options?: WorkflowOptions;
}

export interface WorkflowOptions {
    skipApproval?: boolean;
    dryRun?: boolean;
    notifyOnComplete?: boolean;
}

export interface WorkflowResult {
    taskId: string;
    status: 'completed' | 'failed' | 'cancelled';
    prUrl?: string;
    error?: string;
    completedAt: Date;
}

// =============================================================================
// PLANNER TYPES
// =============================================================================

export interface PlannerOutput {
    proposedChanges: FileChange[];
    verificationPlan: string;
    estimatedEffort: string;
}

// =============================================================================
// CODER TYPES
// =============================================================================

export interface CoderOutput {
    prUrl: string;
    filesChanged: string[];
    testsPassed: boolean;
    commitSha: string;
    error?: string;
}

// =============================================================================
// DEPLOYER TYPES
// =============================================================================

export interface DeployerOutput {
    buildSuccess: boolean;
    testsPassed: boolean;
    deployedTo: string | null;
    logs: string;
}

// =============================================================================
// SUPERVISOR TYPES
// =============================================================================

export interface SupervisorOutput {
    healthStatus: 'healthy' | 'degraded' | 'critical';
    actionsTaken: string[];
    escalated: boolean;
}

// =============================================================================
// NOTIFICATION TYPES
// =============================================================================

export interface NotificationInput {
    subject: string;
    body: string;
    priority?: 'low' | 'normal' | 'high';
}

// =============================================================================
// REVIEWER TYPES
// =============================================================================

export interface ReviewerOutput {
    approved: boolean;
    issues: string[];
    fixSuggestions?: string;
}

// =============================================================================
// CLEANUP TYPES
// =============================================================================

export interface CleanupInput {
    prUrl?: string;
    branchName?: string;
}

export interface CleanupOutput {
    prClosed: boolean;
    branchDeleted: boolean;
    logs: string;
}

// =============================================================================
// HEALTH CHECK TYPES
// =============================================================================

export interface HealthCheckResult {
    service: string;
    status: 'healthy' | 'unhealthy';
    latencyMs: number;
    message?: string;
}

// =============================================================================
// DEPLOY CONFIG TYPES (v3.0.0 - Declarative Deployment)
// =============================================================================

/**
 * Deploy mode determines how code reaches production.
 * - git-direct: Deploy to git repo directly (git pull + rebuild)
 * - rsync: Sync from local worktree to separate build folder
 * - auto: Let AI Swarm detect (legacy heuristic fallback)
 */
export type DeployMode = 'git-direct' | 'rsync' | 'auto';

/**
 * Source of the deploy configuration.
 */
export type DeployConfigSource = 'database' | 'file' | 'llm' | 'default';

/**
 * Build configuration for a project.
 */
export interface DeployBuildConfig {
    /** Working directory relative to project root */
    base: string;
    /** Build command to run before deploy */
    command: string;
    /** Output directory (for rsync mode) */
    outputDir: string;
}

/**
 * Deploy command configuration.
 */
export interface DeployCommandConfig {
    /** Docker services to rebuild (empty = all) */
    services: string[];
    /** Pre-deploy command */
    preCommand: string;
    /** Main deploy command */
    command: string;
    /** Post-deploy command */
    postCommand: string;
}

/**
 * Verification configuration after deployment.
 */
export interface DeployVerifyConfig {
    /** Run Playwright test after deploy */
    browserTest: boolean;
    /** Health check URL to curl */
    healthUrl: string;
}

/**
 * Full deploy configuration for a project.
 * Matches the ai-swarm.deploy.yaml schema.
 */
export interface DeployConfig {
    /** Schema version */
    version: string;
    /** Deploy mode */
    mode: DeployMode;
    /** Build configuration */
    build: DeployBuildConfig;
    /** Deploy configuration */
    deploy: DeployCommandConfig;
    /** Verification configuration */
    verify: DeployVerifyConfig;
}

/**
 * Resolved deploy configuration with source information.
 */
export interface ResolvedDeployConfig extends DeployConfig {
    /** Where this config came from */
    source: DeployConfigSource;
    /** Project ID if resolved from database */
    projectId?: string;
}
