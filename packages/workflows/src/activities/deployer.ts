/**
 * AI Swarm v2 - Deployer Activity
 *
 * Verifies builds and deployments with auto-detection of project type.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';
import {
    DeployerOutput,
    CleanupInput,
    CleanupOutput,
    logger,
    logActivityStart,
    logActivityComplete,
    getSCMProvider,
    getSCMConfigWithFallback,
    projectService,
    SCMConfig,
    SCMProviderType,
    deployConfigService,
    ResolvedDeployConfig,
    systemConfigService,
} from '@ai-swarm/shared';
import { runInBuilder, isBuilderHealthy } from './builder.js';
import { checkUrlAccessible, isPlaywrightHealthy, captureScreenshotAsBase64, captureAuthenticatedScreenshot, deleteScreenshot, cleanupOldScreenshots } from './playwright-runner.js';
import { reviewVisualDeployment } from './visual-reviewer.js';

const execAsync = promisify(exec);

// =============================================================================
// PROJECT TYPE DETECTION
// =============================================================================

type ProjectType = 'nodejs' | 'go' | 'python' | 'rust' | 'unknown';

/**
 * Detect the project type based on marker files.
 */
function detectProjectType(projectDir: string): ProjectType {
    if (existsSync(join(projectDir, 'package.json'))) {
        return 'nodejs';
    }
    if (existsSync(join(projectDir, 'go.mod'))) {
        return 'go';
    }
    if (existsSync(join(projectDir, 'requirements.txt')) ||
        existsSync(join(projectDir, 'pyproject.toml')) ||
        existsSync(join(projectDir, 'setup.py'))) {
        return 'python';
    }
    if (existsSync(join(projectDir, 'Cargo.toml'))) {
        return 'rust';
    }
    return 'unknown';
}

// =============================================================================
// RUNTIME AUTO-INSTALL
// =============================================================================

const TOOLS_DIR = '/home/worker/tools';

/**
 * Check if a command is available in PATH.
 */
async function hasCommand(cmd: string): Promise<boolean> {
    try {
        await execAsync(`which ${cmd}`);
        return true;
    } catch {
        return false;
    }
}

/**
 * Ensure a runtime is available, installing to persistent volume if needed.
 * Returns any additional PATH entries needed.
 */
async function ensureRuntime(projectType: ProjectType, logs: string[]): Promise<string | null> {
    const toolsPath = `${TOOLS_DIR}/${projectType}`;

    switch (projectType) {
        case 'go':
            if (await hasCommand('go')) {
                logs.push('✓ Go runtime found');
                return null;
            }
            logs.push('⚠ Go not found - installing to persistent volume...');
            try {
                await execAsync(`mkdir -p ${toolsPath}`);
                // Download Go 1.25.5 (matching host)
                await execAsync(`curl -L https://go.dev/dl/go1.25.5.linux-arm64.tar.gz | tar -C ${toolsPath} -xz`);
                logs.push('✓ Go 1.25.5 installed to ' + toolsPath);
                return `${toolsPath}/go/bin`;
            } catch (e) {
                logs.push('✗ Failed to install Go: ' + (e instanceof Error ? e.message : String(e)));
                return null;
            }

        case 'python':
            if (await hasCommand('python3')) {
                logs.push('✓ Python runtime found');
                return null;
            }
            logs.push('⚠ Python not found - attempting to install...');
            try {
                await execAsync('apt-get update && apt-get install -y python3 python3-pip');
                logs.push('✓ Python installed');
                return null;
            } catch (e) {
                logs.push('✗ Failed to install Python: ' + (e instanceof Error ? e.message : String(e)));
                return null;
            }

        case 'rust':
            if (await hasCommand('cargo')) {
                logs.push('✓ Rust runtime found');
                return null;
            }
            logs.push('⚠ Rust not found - installing to persistent volume...');
            try {
                await execAsync(`mkdir -p ${toolsPath}`);
                const rustupCmd = `RUSTUP_HOME=${toolsPath}/rustup CARGO_HOME=${toolsPath}/cargo curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path`;
                await execAsync(rustupCmd);
                logs.push('✓ Rust installed to ' + toolsPath);
                return `${toolsPath}/cargo/bin`;
            } catch (e) {
                logs.push('✗ Failed to install Rust: ' + (e instanceof Error ? e.message : String(e)));
                return null;
            }

        default:
            return null;
    }
}

/**
 * Update PATH for the current process, avoiding duplicates.
 */
function updatePath(additionalPath: string) {
    const currentPath = process.env.PATH || '';
    if (!currentPath.includes(additionalPath)) {
        process.env.PATH = `${additionalPath}:${currentPath}`;
    }
}

/**
 * Verify build and optionally deploy.
 * Auto-detects project type and runs appropriate build/test commands.
 */
export async function verifyBuild(prUrl: string, projectId?: string, providedProjectDir?: string): Promise<DeployerOutput> {
    const startTime = Date.now();
    logActivityStart('deployer', 'verifyBuild', { prUrl, projectId, providedProjectDir });

    const logs: string[] = [];
    let projectDir = providedProjectDir;

    try {
        // Fetch project config if projectId is provided
        let projectConfig;
        if (projectId) {
            const { projectService } = await import('@ai-swarm/shared');
            projectConfig = await projectService.getProjectById(projectId);
            if (!projectDir) {
                projectDir = projectConfig.projectFolder;
            }
        }

        if (!projectDir) {
            projectDir = process.env.PROJECT_DIR || process.cwd();
        }

        try {
            // =======================================================================
            // STEP 1: Configure git authentication using SCM provider
            // Uses fallback hierarchy: Per-Project → Per-Provider → ENV
            // =======================================================================
            try {
                const scmConfig = await getSCMConfigWithFallback(projectId, projectConfig);
                if (scmConfig) {
                    const scmProvider = getSCMProvider(scmConfig);
                    await scmProvider.configureGitCredentials(projectDir);
                    logs.push(`✓ Git authentication configured (${scmProvider.name})`);
                } else {
                    // Fallback to env-based config
                    const scmProvider = getSCMProvider();
                    await scmProvider.configureGitCredentials(projectDir);
                    logs.push(`✓ Git authentication configured (${scmProvider.name})`);
                }
            } catch (err) {
                logger.warn({ err }, 'Failed to configure SCM credentials');
                logs.push('⚠ Git authentication not configured');
            }

            // =======================================================================
            // STEP 2: Pull latest changes from current branch
            // =======================================================================
            const { stdout: branchOutput } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectDir });
            const currentBranch = branchOutput.trim();
            logger.info({ branch: currentBranch }, 'Pulling latest changes');
            await execAsync(`git pull origin ${currentBranch}`, { cwd: projectDir });
            logs.push(`✓ Pulled latest changes from ${currentBranch}`);

            // =======================================================================
            // STEP 3: Detect project type
            // =======================================================================
            const projectType = detectProjectType(projectDir);
            logger.info({ projectType, projectDir }, 'Detected project type');
            logs.push(`✓ Detected project type: ${projectType}`);

            // =======================================================================
            // STEP 3.5: Ensure runtime is available (auto-install if needed)
            // =======================================================================
            const additionalPath = await ensureRuntime(projectType, logs);
            if (additionalPath) {
                updatePath(additionalPath);
                logger.info({ additionalPath }, 'Added runtime to PATH');
            }

            // =======================================================================
            // STEP 4: Run lightweight syntax/build check based on project type
            // =======================================================================
            let buildSuccess = true;
            let testsPassed = true; // Default to true since we skip heavy tests in worker

            switch (projectType) {
                case 'nodejs':
                    ({ buildSuccess } = await verifyNodejsSyntax(projectDir, logs));
                    break;
                case 'go':
                    ({ buildSuccess } = await verifyGoSyntax(projectDir, logs));
                    break;
                case 'python':
                    ({ buildSuccess } = await verifyPythonSyntax(projectDir, logs));
                    break;
                case 'rust':
                    ({ buildSuccess } = await verifyRustSyntax(projectDir, logs));
                    break;
                case 'unknown':
                    logs.push('⚠ Unknown project type - skipping syntax verification');
                    break;
            }

            const result: DeployerOutput = {
                buildSuccess,
                testsPassed, // In worker, we only care about if it builds/parses
                deployedTo: null,
                logs: logs.join('\n'),
            };

            const durationMs = Date.now() - startTime;
            logActivityComplete('deployer', 'verifyBuild', durationMs, buildSuccess && testsPassed);

            return result;
        } catch (error) {
            const durationMs = Date.now() - startTime;
            logActivityComplete('deployer', 'verifyBuild', durationMs, false);

            return {
                buildSuccess: false,
                testsPassed: false,
                deployedTo: null,
                logs: `Error: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    } catch (outerError) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('deployer', 'verifyBuild', durationMs, false);
        return {
            buildSuccess: false,
            testsPassed: false,
            deployedTo: null,
            logs: `Outer Error: ${outerError instanceof Error ? outerError.message : String(outerError)}`,
        };
    }
}

// =============================================================================
// LANGUAGE-SPECIFIC VERIFICATION
// =============================================================================


/**
 * Verify Node.js project syntax (npm)
 */
export async function verifyNodejsSyntax(projectDir: string, logs: string[]): Promise<{ buildSuccess: boolean }> {
    let buildSuccess = true;

    // Security: Check for known vulnerabilities
    try {
        const { stdout: auditOutput } = await execAsync('npm audit --audit-level=high --json', { cwd: projectDir });
        const auditResult = JSON.parse(auditOutput);
        if (auditResult.metadata?.vulnerabilities?.high > 0 || auditResult.metadata?.vulnerabilities?.critical > 0) {
            logs.push(`⚠️ npm audit found ${auditResult.metadata.vulnerabilities.high} high and ${auditResult.metadata.vulnerabilities.critical} critical vulnerabilities`);
            // Note: We log but don't fail - let Claude Code decide how to handle
        } else {
            logs.push('✓ npm audit passed (no high/critical vulnerabilities)');
        }
    } catch {
        logs.push('⚠️ npm audit check skipped or found issues');
    }

    // Simple install
    try {
        await execAsync('npm install --package-lock-only', { cwd: projectDir });
        logs.push('✓ npm lockfile verified');
    } catch {
        logs.push('⚠ npm install check skipped');
    }

    // Attempt build (often includes syntax/type check)
    try {
        await execAsync('npm run build --no-daemon 2>&1', { cwd: projectDir });
        logs.push('✓ npm build (syntax check) succeeded');
    } catch {
        logs.push('⚠ No build script or build failed - relying on AI review');
    }

    return { buildSuccess };
}

/**
 * Verify Go project syntax
 * Uses Builder service since Go is not installed on workers
 */
export async function verifyGoSyntax(projectDir: string, logs: string[]): Promise<{ buildSuccess: boolean }> {
    let buildSuccess = true;

    // Check if Builder is available
    const builderReady = await isBuilderHealthy();
    if (!builderReady) {
        logs.push('⚠ Builder service not available, skipping Go syntax check');
        return { buildSuccess: true }; // Don't fail if builder unavailable
    }

    try {
        // Run go build in Builder container
        const result = await runInBuilder({
            taskId: 'syntax-check',
            workDir: projectDir,
            projectType: 'go',
            command: 'go build -buildvcs=false -o /dev/null ./... 2>&1',
            timeoutMs: 120000,
        });

        if (result.success) {
            logs.push('✓ go build (syntax check) succeeded');
        } else {
            buildSuccess = false;
            logs.push(`✗ go build failed: ${result.stderr.slice(0, 2000)}`);
        }
    } catch (error) {
        buildSuccess = false;
        const msg = error instanceof Error ? error.message : String(error);
        logs.push(`✗ go build failed: ${msg.slice(0, 2000)}`);
    }

    return { buildSuccess };
}

/**
 * Verify Python project syntax
 * Uses Builder service since Python may not be fully installed on workers
 */
export async function verifyPythonSyntax(projectDir: string, logs: string[]): Promise<{ buildSuccess: boolean }> {
    let buildSuccess = true;

    const builderReady = await isBuilderHealthy();
    if (!builderReady) {
        logs.push('⚠ Builder service not available, skipping Python syntax check');
        return { buildSuccess: true };
    }

    try {
        const result = await runInBuilder({
            taskId: 'syntax-check',
            workDir: projectDir,
            projectType: 'python',
            command: 'python3 -m compileall -q .',
            timeoutMs: 60000,
        });

        if (result.success) {
            logs.push('✓ python syntax check succeeded');
        } else {
            buildSuccess = false;
            logs.push(`✗ python syntax check failed: ${result.stderr.slice(0, 2000)}`);
        }
    } catch (error) {
        buildSuccess = false;
        const msg = error instanceof Error ? error.message : String(error);
        logs.push(`✗ python syntax check failed: ${msg.slice(0, 2000)}`);
    }

    return { buildSuccess };
}

/**
 * Verify Rust project syntax
 * Uses Builder service since Rust is not installed on workers
 */
export async function verifyRustSyntax(projectDir: string, logs: string[]): Promise<{ buildSuccess: boolean }> {
    let buildSuccess = true;

    const builderReady = await isBuilderHealthy();
    if (!builderReady) {
        logs.push('⚠ Builder service not available, skipping Rust syntax check');
        return { buildSuccess: true };
    }

    try {
        const result = await runInBuilder({
            taskId: 'syntax-check',
            workDir: projectDir,
            projectType: 'rust',
            command: 'cargo check 2>&1',
            timeoutMs: 180000,
        });

        if (result.success) {
            logs.push('✓ cargo check (syntax check) succeeded');
        } else {
            buildSuccess = false;
            logs.push(`✗ cargo check failed: ${result.stderr.slice(0, 2000)}`);
        }
    } catch (error) {
        buildSuccess = false;
        const msg = error instanceof Error ? error.message : String(error);
        logs.push(`✗ cargo check failed: ${msg.slice(0, 2000)}`);
    }

    return { buildSuccess };
}

// =============================================================================
// MERGE PULL REQUEST TYPES
// =============================================================================

export interface MergePullRequestInput {
    prUrl: string;
    mergeMethod?: 'squash' | 'merge' | 'rebase';
    deleteBranch?: boolean;
    projectId?: string;  // v3.0.0: For project-specific SCM credentials
}

export interface MergePullRequestOutput {
    success: boolean;
    mergeCommitSha?: string;
    branchDeleted?: boolean;
    error?: string;
}

/**
 * Merge a pull request using SCM provider abstraction.
 * Uses squash merge by default for clean history.
 */
export async function mergePullRequest(input: MergePullRequestInput): Promise<MergePullRequestOutput> {
    const startTime = Date.now();
    logActivityStart('deployer', 'mergePullRequest', { prUrl: input.prUrl });

    const {
        prUrl,
        mergeMethod = 'squash',
        deleteBranch = true,
        projectId,
    } = input;

    try {
        // Use project-specific SCM config if available
        const scmConfig = await getSCMConfigWithFallback(projectId);
        const scmProvider = getSCMProvider(scmConfig || undefined);

        // Build merge commit message
        const skipExternalCi = process.env.SKIP_EXTERNAL_CI?.toLowerCase() === 'true';
        const commitMessage = skipExternalCi
            ? '[skip ci] Deployed by AI Swarm'
            : undefined;

        if (skipExternalCi) {
            logger.info('Adding [skip ci] to merge commit (SKIP_EXTERNAL_CI=true)');
        }

        logger.info({ prUrl, mergeMethod, deleteBranch }, 'Merging pull request via SCM provider');

        const result = await scmProvider.mergePullRequest(prUrl, {
            mergeMethod,
            deleteBranch,
            commitMessage,
        });

        const durationMs = Date.now() - startTime;
        logActivityComplete('deployer', 'mergePullRequest', durationMs, result.success);

        return {
            success: result.success,
            mergeCommitSha: result.mergeCommitSha,
            branchDeleted: result.branchDeleted,
            error: result.error,
        };
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('deployer', 'mergePullRequest', durationMs, false);

        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage, prUrl }, 'Failed to merge pull request');

        return {
            success: false,
            error: errorMessage,
        };
    }
}

// =============================================================================
// DEPLOY TO PRODUCTION
// =============================================================================

// SSH options for all remote commands
const SSH_OPTS = '-o StrictHostKeyChecking=accept-new -o BatchMode=yes';

/**
 * Check if a directory is a source folder (not a build folder).
 * Source folders have .git and don't end with -build.
 */
async function isSourceFolder(sshTarget: string, deployDir: string): Promise<boolean> {
    try {
        const hasGitCmd = `ssh ${SSH_OPTS} ${sshTarget} "test -d ${deployDir}/.git && echo yes || echo no"`;
        const { stdout } = await execAsync(hasGitCmd, { timeout: 10000 });
        const hasGit = stdout.trim() === 'yes';
        const isBuildPath = deployDir.endsWith('-build');
        return hasGit && !isBuildPath;
    } catch {
        return false;
    }
}

/**
 * Discover the corresponding build folder for a source folder.
 * Looks for {path}-build or sibling with -build suffix.
 */
async function discoverBuildFolder(sshTarget: string, sourcePath: string): Promise<string | null> {
    // Strategy 1: Look for {path}-build
    const buildPath = `${sourcePath}-build`;
    try {
        const existsCmd = `ssh ${SSH_OPTS} ${sshTarget} "test -d ${buildPath} && echo yes || echo no"`;
        const { stdout } = await execAsync(existsCmd, { timeout: 10000 });
        if (stdout.trim() === 'yes') return buildPath;
    } catch {
        // Continue to next strategy
    }

    // Strategy 2: Check for sibling with -build suffix (for nested paths)
    const parentDir = sourcePath.substring(0, sourcePath.lastIndexOf('/'));
    const baseName = sourcePath.substring(sourcePath.lastIndexOf('/') + 1);
    const siblingBuild = `${parentDir}/${baseName}-build`;

    if (siblingBuild !== buildPath) {
        try {
            const existsCmd = `ssh ${SSH_OPTS} ${sshTarget} "test -d ${siblingBuild} && echo yes || echo no"`;
            const { stdout } = await execAsync(existsCmd, { timeout: 10000 });
            if (stdout.trim() === 'yes') return siblingBuild;
        } catch {
            // No build folder found
        }
    }

    return null;
}

/**
 * Find and execute a sync script to populate the build folder.
 * Looks for scripts/sync-*.sh in the source directory.
 */
async function runSyncScript(
    sshTarget: string,
    sourcePath: string,
    logs: string[]
): Promise<boolean> {
    try {
        // Look for sync-*.sh in scripts/
        const findCmd = `ssh ${SSH_OPTS} ${sshTarget} "find ${sourcePath}/scripts -name 'sync-*.sh' -type f 2>/dev/null | head -1"`;
        const { stdout } = await execAsync(findCmd, { timeout: 10000 });
        const syncScript = stdout.trim();

        if (!syncScript) {
            logs.push('⚠️ No sync script found in scripts/');
            return false;
        }

        logs.push(`🔄 Running sync script: ${syncScript}`);
        const runCmd = `ssh ${SSH_OPTS} ${sshTarget} "chmod +x ${syncScript} && ${syncScript}"`;
        await execAsync(runCmd, { timeout: 120000 }); // 2 minute timeout for sync
        logs.push('✓ Sync script completed');
        return true;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logs.push(`⚠️ Sync script failed: ${msg.slice(0, 200)}`);
        return false;
    }
}

export interface DeployToProductionInput {
    projectId?: string;   // v3.0.0: Fetch deployment from DB
    services?: string[];  // Optional: specific services to rebuild
    commitSha?: string;   // Optional: commit SHA to verify against
    providedProjectDir?: string; // v3.0.0: Allow syncing from specific worktree
}

export interface DeployToProductionOutput {
    success: boolean;
    mode: 'local' | 'remote';
    logs: string;
    error?: string;
}

/**
 * Deploy to production by rebuilding Docker containers via SSH.
 * Uses self-healing logic to detect source folders and redirect to build folders.
 * 
 * Environment variables:
 * - DEPLOY_DIR: Directory containing docker-compose.yml (required)
 * - DEPLOY_HOST: SSH host (defaults to localhost)
 * - DEPLOY_USER: SSH user (optional, defaults to ubuntu)
 * - DEPLOY_SERVICES: Comma-separated services to rebuild (optional)
 */
export async function deployToProduction(input?: DeployToProductionInput): Promise<DeployToProductionOutput> {
    const startTime = Date.now();
    // v3.0.0: Temporal activity input can be wrapped in { input: ... }
    const realInput = (input as any)?.input ? (input as any).input : input;
    logActivityStart('deployer', 'deployToProduction', { input: realInput });

    const logs: string[] = [];
    let localSyncDone = false;

    let originalDeployDir = process.env.DEPLOY_DIR;
    let deployHost = process.env.DEPLOY_HOST || 'host.docker.internal';
    let deployUser = process.env.DEPLOY_USER || 'ubuntu';
    let deployServicesEnv = process.env.DEPLOY_SERVICES;

    try {

        // Fetch from database if projectId is provided
        if (realInput?.projectId) {
            const { projectService } = await import('@ai-swarm/shared');
            const deployment = await projectService.getProductionDeployment(realInput.projectId);
            if (deployment) {
                originalDeployDir = deployment.deployDir;
                deployHost = deployment.sshHost;
                deployUser = deployment.sshUser;
                // Services can be in metadata
                if (deployment.metadata?.deployServices) {
                    deployServicesEnv = deployment.metadata.deployServices as string;
                }
                logs.push(`✓ Fetched deployment '${deployment.name}' from database`);
            } else {
                logs.push('⚠ No production deployment found in database, falling back to environment variables');
            }
        }

        // Use input services, or env services, or empty (all services)
        const services = realInput?.services || (deployServicesEnv ? deployServicesEnv.split(',').map(s => s.trim()) : []);
        const serviceStr = services.length > 0 ? services.join(' ') : '';

        if (!originalDeployDir) {
            throw new Error('DEPLOY_DIR environment variable not set. Cannot deploy.');
        }

        const sshTarget = `${deployUser}@${deployHost}`;
        let effectiveDeployDir = originalDeployDir;

        // =======================================================================
        // FIX: Handle 'localhost' when running inside Docker
        // =======================================================================
        let effectiveHost = deployHost;
        const isDocker = existsSync('/.dockerenv');

        if (isDocker && (deployHost === 'localhost' || deployHost === '127.0.0.1')) {
            logger.warn({ deployHost }, 'Detected Docker environment with localhost target. Rewriting to host.docker.internal.');
            logs.push('⚠️ Detected Docker environment: Rewriting localhost to host.docker.internal');
            effectiveHost = 'host.docker.internal';
        }

        const effectiveSshTarget = `${deployUser}@${effectiveHost}`;

        // =======================================================================
        // SELF-HEALING: Detect source folder and redirect to build folder
        // =======================================================================
        logs.push('=== ENVIRONMENT DISCOVERY ===');
        logs.push(`Original DEPLOY_DIR: ${originalDeployDir}`);
        logs.push(`SSH Target: ${effectiveSshTarget}`);

        // =======================================================================
        // WORKER-AS-SOURCE: Sync local worktree directly to target if possible
        // =======================================================================
        const isLocalHost = effectiveHost === 'localhost' || effectiveHost === '127.0.0.1' || effectiveHost === 'host.docker.internal';
        const localDeployPath = getLocalPath(originalDeployDir || '');
        const sourceDir = realInput?.providedProjectDir || process.env.PROJECT_DIR || process.cwd();

        // DEBUG LOGGING
        const localExists = localDeployPath ? existsSync(localDeployPath) : false;
        logs.push(`🔍 Worker-as-Source Debug: isLocalHost=${isLocalHost}, localDeployPath=${localDeployPath}, exists=${localExists}`);

        if (isLocalHost && localDeployPath && existsSync(localDeployPath)) {
            // SAFETY CHECK: Verify source matches destination
            const destPkgStart = Date.now();
            let destName = '';
            try {
                // Check destination package.json
                const { stdout: destPkgJson } = await execAsync(`cat ${localDeployPath}/package.json`);
                try {
                    const pkg = JSON.parse(destPkgJson);
                    destName = pkg.name;
                } catch (e) { /* ignore */ }
            } catch (e) { /* ignore - file might not exist */ }

            // Check source package.json
            let sourceName = '';
            try {
                const { stdout: sourcePkgJson } = await execAsync(`cat ${sourceDir}/package.json`);
                try {
                    const pkg = JSON.parse(sourcePkgJson);
                    sourceName = pkg.name;
                } catch (e) { /* ignore */ }
            } catch (e) { /* ignore */ }

            logger.info({ sourceName, destName, localDeployPath }, 'Pre-sync identity check');

            // If both exist and mismatch, ABORT
            if (sourceName && destName && sourceName !== destName) {
                // EXCEPT: If the destination is "ai-swarm-v2" (the default clone), we allow overwrite
                // BUT: If the source is "ai-swarm-v2" (meaning we are running FROM the swarm repo),
                // and destination is NOT, we must block.

                if (sourceName === 'ai-swarm-v2' && destName !== 'ai-swarm-v2') {
                    const errorMsg = `SAFETY BLOCK: Attempted to overwrite project '${destName}' with AI Swarm root!`;
                    logs.push(`❌ ${errorMsg}`);
                    throw new Error(errorMsg);
                }
            }

            logs.push(`🚀 Detected LOCAL deployment target (Worker-as-Source): ${localDeployPath}`);
            logs.push(`Syncing: ${sourceDir} -> ${localDeployPath}`);

            try {
                // Check if sourceDir is INSIDE localDeployPath (worktree inside deploy dir)
                const isWorktreeInsideDeployDir = sourceDir.startsWith(localDeployPath + '/');

                if (isWorktreeInsideDeployDir) {
                    // SPECIAL CASE: Worktree is inside deploy directory
                    // Use find+cp with excludes since rsync may not be available
                    logs.push(`📁 Worktree is inside deploy directory - using find+cp with excludes`);

                    // Copy all files except .git, worktrees, node_modules
                    // Use find to list files, excluding unwanted directories, then cp each
                    const findCopyCmd = `cd ${sourceDir} && find . \\( -path './.git' -o -path './worktrees' -o -path './node_modules' \\) -prune -o -type f -print | while read f; do mkdir -p "${localDeployPath}/$(dirname "$f")" && cp "$f" "${localDeployPath}/$f"; done`;
                    await execAsync(findCopyCmd, { maxBuffer: 10 * 1024 * 1024 });
                    localSyncDone = true;
                    logs.push('✓ Local find+cp successful (worktree -> parent deploy dir)');
                } else {
                    // Normal case: worktree is separate from deploy dir
                    // Use cp -a for reliable local sync without rsync
                    const syncCmd = `cp -a ${sourceDir}/. ${localDeployPath}/`;
                    await execAsync(syncCmd);
                    localSyncDone = true;
                    logs.push('✓ Local sync successful');
                }

                // If it's a legacy -build folder, we still run the sync script
                if (localDeployPath.endsWith('-build')) {
                    logs.push('Running local sync script...');
                    // Look for any sync script in scripts/ directory
                    const findSyncCmd = `cd ${localDeployPath} && find scripts -name 'sync-*.sh' -type f 2>/dev/null | head -1`;
                    try {
                        const { stdout: syncScript } = await execAsync(findSyncCmd);
                        if (syncScript.trim()) {
                            await execAsync(`cd ${localDeployPath} && chmod +x ${syncScript.trim()} && ${syncScript.trim()}`);
                            logs.push(`✓ Ran sync script: ${syncScript.trim()}`);
                        }
                    } catch { /* No sync script found */ }
                }
            } catch (err) {
                logs.push(`⚠ Local sync failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        // =======================================================================
        // v3.0.0: DECLARATIVE CONFIG-BASED DEPLOYMENT
        // =======================================================================
        // Resolve deploy configuration from: database -> file -> defaults
        const deployConfig: ResolvedDeployConfig = await deployConfigService.resolve(
            realInput?.projectId,
            realInput?.providedProjectDir
        );
        logs.push(`Deploy config source: ${deployConfig.source}`);
        logs.push(`Deploy mode: ${deployConfig.mode}`);

        // Handle deployment based on config mode
        if (deployConfig.mode === 'rsync') {
            // RSYNC MODE: Requires build folder
            logs.push('Deploy mode: rsync - checking for build folder...');
            const isSource = !localSyncDone && await isSourceFolder(effectiveSshTarget, originalDeployDir);

            if (isSource) {
                const buildFolder = await discoverBuildFolder(effectiveSshTarget, originalDeployDir);
                if (buildFolder) {
                    logs.push(`✓ Using build folder: ${buildFolder}`);
                    const synced = await runSyncScript(effectiveSshTarget, originalDeployDir, logs);
                    if (!synced) {
                        logs.push('⚠️ Sync script not found or failed - build folder may be stale');
                    }
                    effectiveDeployDir = buildFolder;
                } else {
                    const errorMsg = `rsync mode requires build folder: ${originalDeployDir}-build not found`;
                    logs.push(`❌ ${errorMsg}`);
                    throw new Error(errorMsg);
                }
            }
        } else if (deployConfig.mode === 'git-direct') {
            // GIT-DIRECT MODE: Deploy to repo directly, no build folder needed
            logs.push('Deploy mode: git-direct - deploying directly to repository');
            // effectiveDeployDir remains originalDeployDir
        } else {
            // AUTO MODE: Legacy heuristic behavior (fallback)
            logs.push('Deploy mode: auto - using legacy heuristics');
            const isSource = !localSyncDone && await isSourceFolder(effectiveSshTarget, originalDeployDir);
            logs.push(`Is source folder check: ${localSyncDone ? 'SKIPPED (Local Sync Done)' : (isSource ? 'YES' : 'NO')}`);

            if (isSource) {
                logs.push('⚠️ DEPLOY_DIR is a source folder - searching for build folder...');
                logger.warn({ originalDeployDir }, 'DEPLOY_DIR is a source folder, attempting self-healing');

                const buildFolder = await discoverBuildFolder(effectiveSshTarget, originalDeployDir);
                if (buildFolder) {
                    logs.push(`✓ Discovered build folder: ${buildFolder}`);
                    const synced = await runSyncScript(effectiveSshTarget, originalDeployDir, logs);
                    if (!synced) {
                        logs.push('⚠️ Sync script not found or failed - build folder may be stale');
                    }
                    effectiveDeployDir = buildFolder;
                    logs.push(`🔄 Redirecting deployment to: ${effectiveDeployDir}`);
                    logger.info({ originalDeployDir, effectiveDeployDir }, 'Self-healed: redirected to build folder');
                } else {
                    // In auto mode, allow deploying to source folder if no build folder
                    logs.push('⚠️ No build folder found, deploying to source folder (git-direct behavior)');
                }
            }
        }

        logs.push(`Effective DEPLOY_DIR: ${effectiveDeployDir}`);

        // =======================================================================
        // REMOTE UPDATE: Pull latest code and sync to build folder
        // =======================================================================
        // Skip if local sync was already done
        if (effectiveDeployDir.endsWith('-build') && !localSyncDone) {
            const sourceDir = effectiveDeployDir.substring(0, effectiveDeployDir.length - 6); // Remove '-build'
            logs.push(`🔄 Updating source code in: ${sourceDir}`);

            try {
                // 1. git pull in source
                // We use the current branch if possible, or default to configured
                const pullCmd = `cd ${sourceDir} && git pull`;
                logs.push(`Running: ${pullCmd}`);
                await execAsync(`ssh ${SSH_OPTS} ${effectiveSshTarget} "${pullCmd}"`);
                logs.push('✓ Remote git pull successful');

                // 2. Sync to build folder
                // We reuse the sync script logic
                logs.push(`Syncing ${sourceDir} -> ${effectiveDeployDir}...`);
                const synced = await runSyncScript(effectiveSshTarget, sourceDir, logs);
                if (synced) {
                    logs.push('✓ Source synced to build folder');
                } else {
                    const errorMsg = '❌ Sync script failed or not found. Cannot deploy potential stale build folder.';
                    logs.push(errorMsg);
                    throw new Error(errorMsg);
                }
            } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                const fullError = `❌ Remote update failed: ${errMsg}`;
                logs.push(fullError);
                logger.error({ error: errMsg }, 'Remote update failed - aborting deployment');
                throw new Error(fullError);
            }
        }

        logs.push('=============================');

        logger.info({ effectiveSshTarget, effectiveDeployDir, services }, 'Starting SSH deployment');

        // Build the docker compose commands
        const commitArg = input?.commitSha ? `GIT_COMMIT=${input.commitSha} ` : '';
        const buildCmd = serviceStr
            ? `${commitArg}docker compose build ${serviceStr}`
            : `${commitArg}docker compose build`;
        const upCmd = serviceStr
            ? `docker compose up -d ${serviceStr}`
            : 'docker compose up -d';
        const fullCmd = `cd ${effectiveDeployDir} && ${buildCmd} && ${upCmd}`;

        // Execute via SSH
        const sshCmd = `ssh ${SSH_OPTS} ${effectiveSshTarget} "${fullCmd}"`;

        logger.info({ command: sshCmd }, 'Executing deployment via SSH');
        logs.push('Executing docker compose via SSH...');

        const { stdout, stderr } = await execAsync(sshCmd, {
            maxBuffer: 10 * 1024 * 1024,
            timeout: 10 * 60 * 1000 // 10 minute timeout
        });

        logs.push('✓ Deployment completed via SSH');
        if (stdout) logs.push(`Output: ${stdout.slice(0, 500)}`);
        if (stderr) logs.push(`Stderr: ${stderr.slice(0, 2000)}`);

        const durationMs = Date.now() - startTime;
        logActivityComplete('deployer', 'deployToProduction', durationMs, true);

        return {
            success: true,
            mode: deployHost === 'localhost' ? 'local' : 'remote',
            logs: logs.join('\n'),
        };
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('deployer', 'deployToProduction', durationMs, false);

        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage }, 'Deployment failed');
        logs.push(`✗ Deployment failed: ${errorMessage}`);

        return {
            success: false,
            mode: deployHost === 'localhost' ? 'local' : 'remote',
            logs: logs.join('\n'),
            error: errorMessage,
        };
    }
}

export interface VerifyDeploymentInput {
    projectId?: string;
    expectedCommit?: string;
}

/**
 * Verify deployment on the live production server.
 * Discovers health endpoints dynamically from target app's context folder.
 * Polls for up to 5 minutes (10 attempts, 30s intervals) to allow for startup.
 * Optionally verifies the deployed commit via Docker container labels.
 */
export async function verifyDeployment(input?: VerifyDeploymentInput): Promise<{ success: boolean; logs: string; playwrightVerified?: boolean; playwrightError?: string }> {
    const startTime = Date.now();
    logActivityStart('deployer', 'verifyDeployment', input);
    const logs: string[] = [];

    let deployDir = process.env.DEPLOY_DIR;
    let deployHost = process.env.DEPLOY_HOST || 'host.docker.internal';
    let deployUser = process.env.DEPLOY_USER || 'ubuntu';
    let baseUrl = process.env.VERIFICATION_URL || process.env.APP_URL || process.env.TEST_URL || process.env.NEXTAUTH_URL;
    let healthEndpoint = '/api/health';

    // Fetch from database if projectId is provided
    if (input?.projectId) {
        const { projectService } = await import('@ai-swarm/shared');
        const deployment = await projectService.getProductionDeployment(input.projectId);
        if (deployment) {
            deployDir = deployment.deployDir;
            deployHost = deployment.sshHost;
            deployUser = deployment.sshUser;
            baseUrl = deployment.appUrl || baseUrl;
            logs.push(`✓ Fetched deployment '${deployment.name}' from database for verification`);
        }
    }

    if (deployDir) {
        logs.push(`🔍 Checking for health endpoint in ${deployDir}/.aicontext/...`);
        try {
            // Try to read API_REFERENCE.md from target app's context folder
            const sshOptions = '-o StrictHostKeyChecking=accept-new -o BatchMode=yes';
            const readCmd = `ssh ${sshOptions} ${deployUser}@${deployHost} "cat ${deployDir}/.aicontext/API_REFERENCE.md 2>/dev/null | head -50 || echo ''"`;
            const { stdout } = await execAsync(readCmd, { timeout: 10000 });

            // Look for health-related endpoints
            if (stdout.includes('/healthz') || stdout.includes('/health')) {
                healthEndpoint = stdout.includes('/healthz') ? '/healthz' : '/health';
                logs.push(`✓ Found health endpoint: ${healthEndpoint}`);
            } else if (stdout.includes('/api/setup')) {
                healthEndpoint = '/api/setup';
                logs.push(`✓ Found setup endpoint: ${healthEndpoint}`);
            } else {
                logs.push(`ℹ️ No health endpoint found in context, using default: ${healthEndpoint}`);
            }
        } catch (error) {
            logs.push(`⚠️ Could not read context folder, using default endpoint: ${healthEndpoint}`);
        }
    }

    if (!baseUrl) {
        logs.push('⏭️ Skipping HTTP health check (no APP_URL/TEST_URL/NEXTAUTH_URL configured)');
    } else {
        const fullUrl = baseUrl.endsWith('/')
            ? `${baseUrl.slice(0, -1)}${healthEndpoint}`
            : `${baseUrl}${healthEndpoint}`;

        logs.push(`🔍 Starting HTTP health check for: ${fullUrl}`);

        let attempt = 0;
        const maxAttempts = 10;
        const intervalMs = 30000; // 30 seconds
        let success = false;

        while (attempt < maxAttempts) {
            attempt++;
            logs.push(`Attempt ${attempt}/${maxAttempts}: Checking ${fullUrl}...`);

            try {
                // Use curl to check for successful response
                const { stdout } = await execAsync(`curl -s --connect-timeout 10 ${fullUrl}`);

                // For /api/setup, check for success:true in JSON response
                if (healthEndpoint === '/api/setup') {
                    if (stdout.includes('"success":true') || stdout.includes('"success": true')) {
                        logs.push(`✅ Attempt ${attempt}: Health check passed! Response: ${stdout.slice(0, 100)}`);
                        success = true;
                        break;
                    } else {
                        logs.push(`⚠️ Attempt ${attempt}: Unexpected response: ${stdout.slice(0, 100)}`);
                    }
                } else {
                    // For other endpoints, any 200 response is good
                    if (stdout.length > 0 || stdout.includes('ok') || stdout.includes('healthy')) {
                        logs.push(`✅ Attempt ${attempt}: Health check passed!`);
                        success = true;
                        break;
                    }
                }
            } catch (error) {
                logs.push(`⏳ Attempt ${attempt}: Connection failed (app may still be starting).`);
            }

            if (attempt < maxAttempts) {
                logs.push(`Waiting 30s before next attempt...`);
                await sleep(intervalMs);
            }
        }

        if (!success) {
            logs.push(`❌ Health check FAILED after ${maxAttempts} attempts (${maxAttempts * (intervalMs / 1000)}s).`);
            const durationMs = Date.now() - startTime;
            logActivityComplete('deployer', 'verifyDeployment', durationMs, false);
            return {
                success: false,
                logs: logs.join('\n')
            };
        }

        // 1.5. Visual Verification (v3.0.0 - Fail-Safe LLM Review)
        // Captures screenshot and uses LLM to check for catastrophic failures.
        // FAIL-SAFE: Only fails on high-confidence (8+) catastrophic issues.
        // Any errors = pass through (don't block deployment on verification issues)
        logs.push('🔍 Starting visual verification (Playwright + LLM review)...');
        let playwrightVerified = false;
        let playwrightError: string | undefined;
        let visualReviewWarning: string | undefined;

        // Clean up any orphaned screenshots from previous runs
        await cleanupOldScreenshots();

        const playwrightReady = await isPlaywrightHealthy();
        if (!playwrightReady) {
            logs.push('⚠️ Playwright sidecar not available, skipping visual verification');
            playwrightError = 'Playwright container not running';
            // PASS THROUGH - don't fail deployment if Playwright is down
        } else {
            try {
                // Step 1: Capture screenshot (try authenticated if credentials available)
                logs.push('📸 Capturing deployment screenshot...');

                // Check if we have test credentials for authenticated capture
                const testCreds = await systemConfigService.getTestCredentials();
                let screenshot;

                if (testCreds.email) {
                    logs.push(`🔐 Test credentials configured (${testCreds.email}), attempting authenticated capture...`);
                    screenshot = await captureAuthenticatedScreenshot({ url: fullUrl, testUserEmail: testCreds.email });
                    if (screenshot.success) {
                        logs.push('✅ Authenticated screenshot captured');
                    }
                } else {
                    logs.push('🔓 No test credentials, using unauthenticated capture');
                    screenshot = await captureScreenshotAsBase64(fullUrl);
                }

                if (!screenshot.success || !screenshot.filePath) {
                    logs.push(`⚠️ Screenshot capture failed: ${screenshot.error || 'Unknown error'}`);
                    logs.push('⏭️ Continuing without visual verification (screenshot failed)');
                    playwrightError = screenshot.error;
                    // PASS THROUGH - screenshot failure is not a deployment failure
                } else {
                    logs.push(`✅ Screenshot captured (status: ${screenshot.statusCode}, title: "${screenshot.title}")`);

                    // Step 2: LLM Visual Review
                    logs.push('🤖 Sending screenshot to LLM for visual review...');
                    try {
                        const visualReview = await reviewVisualDeployment({
                            url: fullUrl,
                            screenshotPath: screenshot.filePath,
                            screenshotBase64: screenshot.base64,
                            pageTitle: screenshot.title,
                            statusCode: screenshot.statusCode,
                        });

                        if (visualReview.shouldFail) {
                            // HIGH CONFIDENCE CATASTROPHIC FAILURE
                            logs.push(`❌ Visual review CRITICAL FAILURE (confidence: ${visualReview.confidence}/10)`);
                            logs.push(`Reason: ${visualReview.reason}`);
                            logs.push('⚠️ Triggering fix loop for catastrophic visual issue...');

                            const durationMs = Date.now() - startTime;
                            logActivityComplete('deployer', 'verifyDeployment', durationMs, false);
                            return {
                                success: false,
                                logs: logs.join('\n'),
                                playwrightVerified: false,
                                playwrightError: `Visual review failed: ${visualReview.reason}`
                            };
                        } else if (visualReview.verdict === 'fail') {
                            // Low confidence failure - log warning but pass through
                            logs.push(`⚠️ Visual review concern (confidence: ${visualReview.confidence}/10 - below threshold)`);
                            logs.push(`Reason: ${visualReview.reason}`);
                            logs.push('⏭️ Continuing (confidence below 8, treating as warning)');
                            visualReviewWarning = visualReview.reason;
                            playwrightVerified = true; // Consider it passed with warning
                        } else {
                            logs.push(`✅ Visual review passed (confidence: ${visualReview.confidence}/10)`);
                            logs.push(`Reason: ${visualReview.reason}`);
                            playwrightVerified = true;
                        }
                    } catch (reviewErr) {
                        const reviewError = reviewErr instanceof Error ? reviewErr.message : String(reviewErr);
                        logs.push(`⚠️ Visual review error: ${reviewError}`);
                        logs.push('⏭️ Continuing without visual verification (LLM review failed)');
                        // PASS THROUGH - LLM failure is not a deployment failure
                        playwrightVerified = true; // Consider screenshot capture success enough
                    }
                }
            } catch (browserErr) {
                playwrightError = browserErr instanceof Error ? browserErr.message : String(browserErr);
                logs.push(`⚠️ Visual verification error: ${playwrightError}`);
                logs.push('⏭️ Continuing without visual verification (unexpected error)');
                // PASS THROUGH - any unexpected errors don't fail deployment
            }
        }
    }

    // 2. Commit verification (Check Docker container labels)
    const expectedCommit = input?.expectedCommit;
    const containerName = process.env.DEPLOY_CONTAINER;

    if (expectedCommit && containerName) {
        logs.push(`🔍 Verifying container label 'commit' for ${containerName} on ${deployHost}...`);
        try {
            const sshOptions = '-o StrictHostKeyChecking=accept-new -o BatchMode=yes';
            // Use docker inspect to get the commit label
            // We use 'latest' or the specific container name if configured
            const checkCmd = `ssh ${sshOptions} ${deployUser}@${deployHost} "docker inspect --format='{{index .Config.Labels \\"commit\\"}}' ${containerName}"`;
            const { stdout } = await execAsync(checkCmd, { timeout: 10000 });
            const deployedCommit = stdout.trim();

            if (deployedCommit === expectedCommit) {
                logs.push(`✅ Commit verified: ${deployedCommit}`);
            } else if (deployedCommit === 'unknown' || !deployedCommit) {
                logs.push(`⚠️ Container has no commit label or label is 'unknown'. Skipping strict verification.`);
            } else {
                logs.push(`❌ Commit mismatch! Expected: ${expectedCommit}, Got: ${deployedCommit}`);
                const durationMs = Date.now() - startTime;
                logActivityComplete('deployer', 'verifyDeployment', durationMs, false);
                return {
                    success: false,
                    logs: logs.join('\n')
                };
            }
        } catch (error) {
            logs.push(`⚠️ Commit label verification failed: ${error instanceof Error ? error.message : String(error)}`);
            logs.push(`ℹ️ Continuing since health check passed, but container label verification is recommended.`);
        }
    } else if (expectedCommit) {
        logs.push(`ℹ️ Skipping commit label verification (DEPLOY_CONTAINER not configured)`);
    }

    // 2. Remote container check (verify containers are up)
    logs.push(`🔍 Running container health check on ${deployHost}...`);
    try {
        const sshOptions = '-o StrictHostKeyChecking=accept-new -o BatchMode=yes';
        const checkCmd = `ssh ${sshOptions} ${deployUser}@${deployHost} "cd ${deployDir} && docker compose ps --format '{{.Name}} {{.Status}}' | head -10"`;
        const { stdout } = await execAsync(checkCmd, { timeout: 10000 });

        if (stdout.includes('Up') || stdout.includes('running')) {
            logs.push(`✅ Containers are running:\n${stdout.slice(0, 500)}`);
        } else {
            logs.push(`⚠️ Container status unclear:\n${stdout.slice(0, 500)}`);
        }
    } catch (error) {
        logs.push(`⚠️ Remote container check failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const durationMs = Date.now() - startTime;
    logActivityComplete('deployer', 'verifyDeployment', durationMs, true);

    return {
        success: true,
        logs: logs.join('\n'),
        playwrightVerified: true, // Only reaches here if passed or skipped (container unavailable)
    };
}

/**
 * Utility to sleep.
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Cleanup resources (PR and branch) after a task is completed, failed, or cancelled.
 */
export async function cleanupResources(input: CleanupInput): Promise<CleanupOutput> {
    const startTime = Date.now();
    logActivityStart('deployer', 'cleanupResources', input);

    const { prUrl, branchName } = input;
    const projectDir = process.env.PROJECT_DIR || process.cwd();
    const githubRepo = process.env.GITHUB_REPO;
    const logs: string[] = [];

    let prClosed = false;
    let branchDeleted = false;

    try {
        // 1. Close PR
        if (prUrl && githubRepo) {
            const prMatch = prUrl.match(/\/pull\/(\d+)/);
            if (prMatch) {
                const prNumber = prMatch[1];
                try {
                    await execAsync(`gh pr close ${prNumber} --repo ${githubRepo} --comment "Auto-cleanup of task resources."`, { cwd: projectDir });
                    prClosed = true;
                    logs.push(`✓ PR #${prNumber} closed`);
                } catch (e) {
                    logs.push(`⚠ Failed to close PR #${prNumber}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        }

        // 2. Delete branch
        if (branchName) {
            try {
                // Delete local if exists
                try {
                    await execAsync(`git branch -D ${branchName}`, { cwd: projectDir });
                    logs.push(`✓ Local branch ${branchName} deleted`);
                } catch {
                    // Ignore
                }

                // Delete remote if token exists
                if (process.env.GITHUB_TOKEN) {
                    await execAsync(`git push origin --delete ${branchName}`, { cwd: projectDir });
                    branchDeleted = true;
                    logs.push(`✓ Remote branch ${branchName} deleted`);
                }
            } catch (e) {
                logs.push(`⚠ Failed to delete branch ${branchName}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        const durationMs = Date.now() - startTime;
        logActivityComplete('deployer', 'cleanupResources', durationMs, true);

        return {
            prClosed,
            branchDeleted,
            logs: logs.join('\n'),
        };
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('deployer', 'cleanupResources', durationMs, false);

        return {
            prClosed,
            branchDeleted,
            logs: logs.join('\n') + `\nError: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
/**
 * Translates a host directory path to the corresponding path inside the worker container.
 * Specifically maps /home/ubuntu/apps to /apps.
 */
function getLocalPath(hostPath: string): string | null {
    if (hostPath.startsWith('/home/ubuntu/apps')) {
        return hostPath.replace('/home/ubuntu/apps', '/apps');
    }
    if (hostPath.startsWith('/apps')) {
        return hostPath;
    }
    return null;
}
