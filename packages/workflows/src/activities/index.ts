/**
 * AI Swarm v3.0.0 - Activities Index
 */

export {
    planTask,
    reviewCode,
} from './planner.js';
export { executeCode } from './coder.js';
export {
    verifyBuild,
    mergePullRequest,
    deployToProduction,
    verifyDeployment,
    cleanupResources,
} from './deployer.js';
export { performHealthCheck, runCleanup, checkKillSwitch } from './supervisor.js';
export { sendNotification } from './notification.js';
export { rollbackCommit, createFixTask, checkFixTaskLoop } from './rollback.js';
export { createWorktree, removeWorktree, pruneWorktrees } from './worktree-manager.js';
export { runBrowserTest } from './tester.js';

// v3.0.0: New sidecar activities
export { runInBuilder, installToolInBuilder, isBuilderHealthy } from './builder.js';
export { runPlaywrightTest, checkUrlAccessible, isPlaywrightHealthy, captureScreenshotAsBase64, captureAuthenticatedScreenshot, deleteScreenshot, cleanupOldScreenshots } from './playwright-runner.js';
export { reviewVisualDeployment } from './visual-reviewer.js';
export { updateProjectContext } from './update-context.js';
export { checkAuthStatus } from './system.js';

// v3.0.0: LLM Deployer activities
export {
    analyzeDeploymentContext,
    troubleshootDeployment,
    executeRecoveryAction,
    getContainerLogs,
} from './llm-deployer.js';

// v3.0.0: Declarative Deployment Config
export { analyzeDeployConfig } from './analyzeDeployConfig.js';
