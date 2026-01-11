/**
 * AI Swarm v2 - Coder Activity
 *
 * Executes implementation plans and creates PRs using Gemini CLI.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import {
    ImplementationPlan,
    CoderOutput,
    invokeGeminiCLI,
    loadSystemPrompt,
    logger,
    logActivityStart,
    logActivityComplete,
    getSCMProvider,
    getSCMConfigWithFallback,
    systemConfigService,
} from '@ai-swarm/shared';
import {
    verifyGoSyntax,
    verifyNodejsSyntax,
    verifyPythonSyntax,
    verifyRustSyntax,
} from './deployer.js';
import { join } from 'path';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

/**
 * Execute an implementation plan and create a PR.
 */
export async function executeCode(input: ImplementationPlan): Promise<CoderOutput> {
    const startTime = Date.now();
    // v3.0.0: Temporal activity input can be wrapped in { input: ... }
    const plan = (input as any)?.input ? (input as any).input : input;
    logActivityStart('coder', 'executeCode', { taskId: plan.taskId });

    // =======================================================================
    // STEP 0: Worktree / Project Dir Setup
    // =======================================================================
    let projectDir = process.env.PROJECT_DIR || process.cwd();

    // Check if worktree path is provided in context
    const worktreeMatch = plan.context?.match(/\*\*WORKTREE PATH:\*\* (.*)/);
    const isWorktree = !!worktreeMatch;
    if (worktreeMatch) {
        projectDir = worktreeMatch[1].trim();
        logger.info({ projectDir }, 'Using worktree for task execution');
    }

    // Generate branch name from task ID
    const branchName = `ai-swarm/${plan.taskId}`;

    try {
        // Configure SCM provider credentials from project config
        const scmConfig = await getSCMConfigWithFallback(plan.projectId);
        try {
            const scmProvider = getSCMProvider(scmConfig || undefined);
            await scmProvider.configureGitCredentials(projectDir);
            logger.info({ provider: scmProvider.name }, 'SCM credentials configured');
        } catch (err) {
            logger.warn({ err }, 'Failed to configure SCM credentials');
        }

        // Set identity if not set
        await execAsync('git config --global user.email "swarm-bot@example.com"', { cwd: projectDir });
        await execAsync('git config --global user.name "AI Swarm Bot"', { cwd: projectDir });

        // v3.0.0: Skip branch management if using worktree
        // Worktrees are already created on their own branch by worktree-manager
        let actualBranchName = branchName;
        if (isWorktree) {
            // Get the current branch name from the worktree
            const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectDir });
            actualBranchName = currentBranch.trim();
            logger.info({ actualBranchName, projectDir }, 'Using existing worktree branch');
        } else {
            // Legacy mode: create branch in main repo
            logger.info({ branchName }, 'Creating feature branch');
            await execAsync('git fetch origin main', { cwd: projectDir });
            await execAsync('git checkout main', { cwd: projectDir });
            await execAsync('git pull origin main', { cwd: projectDir });

            // Check if branch exists and delete it
            try {
                await execAsync(`git branch -D ${branchName}`, { cwd: projectDir });
            } catch {
                // Branch doesn't exist, that's fine
            }

            await execAsync(`git checkout -b ${branchName}`, { cwd: projectDir });
        }

        // =======================================================================
        // STEP 2: Invoke LLM to implement changes (Gemini vs Claude)
        // =======================================================================
        let response: string;
        const coderProvider = await systemConfigService.getLLMRole('coder');
        const claudeAuthMode = await systemConfigService.getClaudeAuthMode();
        const zaiApiKey = await systemConfigService.getZaiApiKey();

        // Use Claude ONLY if explicitly selected AND auth is configured
        const useClaudeCode = coderProvider === 'claude' && (claudeAuthMode === 'oauth' || (claudeAuthMode === 'zai' && zaiApiKey));

        if (useClaudeCode) {
            logger.info({ authMode: claudeAuthMode }, 'Using Claude Code for implementation (selected in portal)');
            // Import the activity dynamically to avoid circular dependencies if any, 
            // but here it's fine as it's a separate file.
            const { executeClaudeCode } = await import('./llm-claude.js');

            const claudeResult = await executeClaudeCode({
                task: `Implement the following plan:\n${plan.proposedChanges.map((c: any) => `- ${c.action.toUpperCase()} ${c.path}: ${c.description}`).join('\n')}\n\nVerification: ${plan.verificationPlan}`,
                projectDir,
                context: plan.context,
            });

            if (!claudeResult.success) {
                throw new Error(`Claude Code failed: ${claudeResult.error}`);
            }

            response = claudeResult.stdout;

            // Note: Claude Code typically handles git add/commit if configured, 
            // but we'll do it explicitly below for consistency in the workflow.
        } else {
            logger.info('Using Gemini CLI for implementation (default or selected in portal)');
            const systemPrompt = await loadSystemPrompt('coder');

            const prompt = `${systemPrompt}

## Implementation Plan

**Task ID:** ${plan.taskId}

**Changes to Implement:**
${plan.proposedChanges.map((c: any) => `- ${c.action.toUpperCase()} ${c.path}: ${c.description}`).join('\n')}

**Verification Plan:**
${plan.verificationPlan}

---

Implement ALL the changes described above. After making changes:
1. Run: git add .
2. Run: git commit -m "feat(${plan.taskId}): implement changes"
3. Run: git push origin ${actualBranchName}

Return ONLY valid JSON with the result.`;

            response = await invokeGeminiCLI(prompt, {
                role: 'coder',
                cwd: projectDir,
            });
        }

        // =======================================================================
        // STEP 2.5: Local Verification (NEW)
        // =======================================================================
        const logs: string[] = [];
        let buildSuccess = true;

        // Detect project type (duplicated logic for speed, or we can export detection)
        let projectType: 'nodejs' | 'go' | 'python' | 'rust' | 'unknown' = 'unknown';
        if (existsSync(join(projectDir, 'package.json'))) projectType = 'nodejs';
        else if (existsSync(join(projectDir, 'go.mod'))) projectType = 'go';
        else if (existsSync(join(projectDir, 'requirements.txt')) || existsSync(join(projectDir, 'pyproject.toml'))) projectType = 'python';
        else if (existsSync(join(projectDir, 'Cargo.toml'))) projectType = 'rust';

        logger.info({ projectType }, 'Running local verification before push');

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
        }

        if (!buildSuccess) {
            logger.warn({ projectType, logs }, 'Local verification failed');
            return {
                prUrl: '',
                filesChanged: [],
                testsPassed: false,
                commitSha: '',
                error: logs.join('\n'), // Pass the error back to the workflow
            };
        }

        // Parse JSON from response
        const coderOutput = parseJsonFromResponse<Partial<CoderOutput>>(response);

        // =======================================================================
        // STEP 3: Verify and extract results
        // =======================================================================

        // Get commit SHA
        let commitSha = coderOutput.commitSha || '';
        if (!commitSha) {
            try {
                const { stdout } = await execAsync('git rev-parse HEAD', { cwd: projectDir });
                commitSha = stdout.trim();
            } catch {
                commitSha = 'unknown';
            }
        }

        // Get changed files
        let filesChanged = coderOutput.filesChanged || [];
        if (filesChanged.length === 0) {
            try {
                const { stdout } = await execAsync('git diff --name-only HEAD~1', { cwd: projectDir });
                filesChanged = stdout.trim().split('\n').filter(Boolean);
            } catch {
                filesChanged = [];
            }
        }

        // Get or create PR/MR URL using SCM provider
        let prUrl = coderOutput.prUrl || '';
        if (!prUrl) {
            try {
                // Use project-specific SCM config if available
                const scmConfig = await getSCMConfigWithFallback(plan.projectId);
                const scmProvider = getSCMProvider(scmConfig || undefined);

                // Configure the correct remote URL for this SCM provider
                // This ensures we push to the right place (GitHub, GitLab, Azure DevOps, etc.)
                const repoUrl = scmProvider.getRepoUrl();
                logger.info({ repoUrl, provider: scmProvider.name }, 'Using SCM provider remote URL');

                // Set up a temporary remote or update origin to use the correct URL with credentials
                await scmProvider.configureGitCredentials(projectDir);

                // Push branch to the SCM provider's remote
                logger.info({ actualBranchName }, 'Pushing feature branch to remote');
                await execAsync(`git push -u origin ${actualBranchName}`, { cwd: projectDir });

                prUrl = await scmProvider.createPullRequest({
                    title: `feat(${plan.taskId}): ${plan.proposedChanges[0]?.description || 'implement changes'}`,
                    description: `Automated PR created by AI Swarm\n\n${plan.verificationPlan}`,
                    sourceBranch: actualBranchName,
                    targetBranch: 'main',
                    squashMerge: true,
                    deleteSourceBranch: true,
                });
                logger.info({ prUrl }, 'Created PR using SCM provider');
            } catch (prError) {
                const errorMessage = prError instanceof Error ? prError.message : String(prError);
                logger.warn({ error: errorMessage }, 'Failed to create PR');
                prUrl = 'PR creation failed';
            }
        }

        const result: CoderOutput = {
            prUrl,
            filesChanged,
            testsPassed: coderOutput.testsPassed ?? true,
            commitSha,
        };

        const durationMs = Date.now() - startTime;
        logActivityComplete('coder', 'executeCode', durationMs, true);

        return result;
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('coder', 'executeCode', durationMs, false);
        throw error;
    }
}

/**
 * Parse JSON from a potentially messy LLM response.
 */
function parseJsonFromResponse<T>(response: string): T {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        logger.warn({ response: response.slice(0, 500) }, 'No JSON found in Coder response');
        return {} as T;
    }

    try {
        return JSON.parse(jsonMatch[0]) as T;
    } catch {
        logger.warn({ json: jsonMatch[0].slice(0, 500) }, 'Invalid JSON in Coder response');
        return {} as T;
    }
}
