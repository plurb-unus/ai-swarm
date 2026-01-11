/**
 * AI Swarm v3.0.0 - LLM Deployer Activity
 * 
 * Provides LLM-powered intelligence for deployment orchestration:
 * - Pre-deployment context analysis
 * - Failure troubleshooting with log access
 * - Recovery action suggestions
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import {
    logger,
    logActivityStart,
    logActivityComplete,
    invokeLLM,
    loadSystemPrompt,
    systemConfigService,
} from '@ai-swarm/shared';

const execAsync = promisify(exec);

// =============================================================================
// TYPES
// =============================================================================

export interface DeploymentAnalysis {
    analysis: string;
    risks: string[];
    recommendations: string[];
}

export interface TroubleshootResult {
    analysis: string;
    errorType: 'code' | 'infrastructure' | 'unknown';
    errorSummary: string;  // Concise summary for Coder handoff
    suggestedAction?: RecoveryAction;
}

export interface RecoveryAction {
    type: 'restart_container' | 'rebuild_container' | 'run_migration' | 'wait_and_retry' | 'clear_volume' | 'escalate';
    target: string | null;
    command: string;
}

export interface AnalyzeDeploymentInput {
    projectId: string;
    deployDir: string;
    changedFiles: string[];
    sshHost?: string;
    sshUser?: string;
}

export interface TroubleshootDeploymentInput {
    projectId: string;
    error: string;
    logs: string;
    attemptNumber: number;
    sshHost?: string;
    sshUser?: string;
}

export interface SuggestRecoveryInput {
    analysis: TroubleshootResult;
    blacklist: string[];
}

// =============================================================================
// HELPER: Get Container Logs (200 line limit)
// =============================================================================

const SSH_OPTS = '-o StrictHostKeyChecking=accept-new -o BatchMode=yes';

/**
 * Get container logs with 200 line tail limit to prevent context overflow.
 */
export async function getContainerLogs(
    containerName: string,
    sshHost: string = 'host.docker.internal',
    sshUser: string = 'ubuntu'
): Promise<string> {
    try {
        const isLocal = !sshHost || sshHost === 'host.docker.internal' || sshHost === '127.0.0.1' || sshHost === 'localhost';
        const cmd = isLocal
            ? `docker logs ${containerName} --tail 200 2>&1`
            : `ssh ${SSH_OPTS} ${sshUser}@${sshHost} "docker logs ${containerName} --tail 200 2>&1"`;

        const { stdout } = await execAsync(cmd, { timeout: 30000 });
        return stdout;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn({ containerName, error: msg }, 'Failed to get container logs');
        return `[Error fetching logs: ${msg}]`;
    }
}

/**
 * List running containers on the deployment host.
 */
async function listContainers(
    sshHost: string = 'host.docker.internal',
    sshUser: string = 'ubuntu'
): Promise<string[]> {
    try {
        const isLocal = !sshHost || sshHost === 'host.docker.internal' || sshHost === '127.0.0.1' || sshHost === 'localhost';
        const cmd = isLocal
            ? `docker ps --format '{{.Names}}'`
            : `ssh ${SSH_OPTS} ${sshUser}@${sshHost} "docker ps --format '{{.Names}}'"`;

        const { stdout } = await execAsync(cmd, { timeout: 10000 });
        return stdout.split('\n').filter(Boolean);
    } catch (error) {
        logger.warn({ error }, 'Failed to list containers');
        return [];
    }
}

// =============================================================================
// ANALYZE DEPLOYMENT CONTEXT
// =============================================================================

/**
 * Pre-deployment intelligence: Analyze context and identify potential issues.
 */
export async function analyzeDeploymentContext(
    input: AnalyzeDeploymentInput
): Promise<DeploymentAnalysis> {
    const startTime = Date.now();
    logActivityStart('deployer', 'analyzeDeploymentContext', input);

    try {
        const systemPrompt = await loadSystemPrompt('deployer');

        const prompt = `${systemPrompt}

## Task: Analyze Deployment Context

You are preparing to deploy changes to the following environment:

**Project ID:** ${input.projectId}
**Deploy Directory:** ${input.deployDir}
**Changed Files:**
${input.changedFiles.map(f => `- ${f}`).join('\n') || '(no files specified)'}

Analyze this deployment context and identify:
1. What type of changes are being deployed (frontend, backend, database, etc.)
2. Any potential risks or issues
3. Pre-deployment recommendations

Return your analysis as JSON:
\`\`\`json
{
  "analysis": "Brief summary of deployment context",
  "risks": ["list", "of", "potential", "issues"],
  "recommendations": ["pre-deployment", "suggestions"]
}
\`\`\``;

        const response = await invokeLLM(prompt, { role: 'deployer', cwd: input.deployDir });

        // Parse JSON from response
        const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
            response.match(/\{[\s\S]*"analysis"[\s\S]*\}/);

        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);

            // Ensure array fields are actually arrays to prevent runtime errors
            const result: DeploymentAnalysis = {
                analysis: parsed.analysis || 'No analysis provided',
                risks: Array.isArray(parsed.risks) ? parsed.risks : [],
                recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : []
            };

            const durationMs = Date.now() - startTime;
            logActivityComplete('deployer', 'analyzeDeploymentContext', durationMs, true);
            return result;
        }

        throw new Error('Failed to parse LLM response as JSON');
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('deployer', 'analyzeDeploymentContext', durationMs, false);

        logger.error({ error }, 'analyzeDeploymentContext failed');
        return {
            analysis: 'Analysis failed - proceeding with standard deployment',
            risks: [],
            recommendations: [],
        };
    }
}

// =============================================================================
// TROUBLESHOOT DEPLOYMENT
// =============================================================================

/**
 * Analyze deployment failure and classify error type.
 * Returns concise summary for Coder if code error, or recovery action if infra error.
 */
export async function troubleshootDeployment(
    input: TroubleshootDeploymentInput
): Promise<TroubleshootResult> {
    const startTime = Date.now();
    logActivityStart('deployer', 'troubleshootDeployment', {
        projectId: input.projectId,
        attemptNumber: input.attemptNumber
    });

    try {
        const systemPrompt = await loadSystemPrompt('deployer');
        const blacklist = await systemConfigService.getDeployerBlacklist();

        // Get container list for context
        const containers = await listContainers(
            input.sshHost || 'host.docker.internal',
            input.sshUser || 'ubuntu'
        );

        const prompt = `${systemPrompt}

## Task: Troubleshoot Deployment Failure

A deployment has failed. This is attempt #${input.attemptNumber} of 3.

**Project ID:** ${input.projectId}
**Error Message:**
${input.error}

**Recent Logs (last 200 lines):**
${input.logs.slice(-10000)}  

**Running Containers:**
${containers.join(', ') || '(none found)'}

**Protected Containers (BLACKLIST - do NOT touch):**
${blacklist.join(', ')}

Analyze this failure and determine:
1. Is this a CODE error (syntax, imports, types) or INFRASTRUCTURE error (containers, network, resources)?
2. If CODE error: provide a concise summary (max 500 chars) for the Coder to fix
3. If INFRASTRUCTURE error: suggest a recovery action

Return your analysis as JSON:
\`\`\`json
{
  "analysis": "What went wrong and why",
  "errorType": "code" | "infrastructure" | "unknown",
  "errorSummary": "Concise summary for Coder (only if code error, max 500 chars)",
  "suggestedAction": {
    "type": "restart_container" | "rebuild_container" | "run_migration" | "wait_and_retry" | "escalate",
    "target": "container name or null",
    "command": "exact command to run"
  }
}
\`\`\``;

        const response = await invokeLLM(prompt, { role: 'deployer' });

        // Parse JSON from response
        const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
            response.match(/\{[\s\S]*"errorType"[\s\S]*\}/);

        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]) as TroubleshootResult;

            // Validate blacklist - ensure suggested action doesn't target protected containers
            if (parsed.suggestedAction?.target && blacklist.includes(parsed.suggestedAction.target)) {
                logger.warn(
                    { target: parsed.suggestedAction.target },
                    'LLM suggested action on blacklisted container - overriding to escalate'
                );
                parsed.suggestedAction = {
                    type: 'escalate',
                    target: null,
                    command: 'Manual intervention required - protected container affected',
                };
            }

            const durationMs = Date.now() - startTime;
            logActivityComplete('deployer', 'troubleshootDeployment', durationMs, true);
            return parsed;
        }

        throw new Error('Failed to parse LLM response as JSON');
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('deployer', 'troubleshootDeployment', durationMs, false);

        logger.error({ error }, 'troubleshootDeployment failed');
        return {
            analysis: `Troubleshooting failed: ${error instanceof Error ? error.message : String(error)}`,
            errorType: 'unknown',
            errorSummary: 'Deployment failed - unable to classify error automatically',
            suggestedAction: {
                type: 'escalate',
                target: null,
                command: 'Manual intervention required',
            },
        };
    }
}

// =============================================================================
// EXECUTE RECOVERY ACTION
// =============================================================================

/**
 * Execute a recovery action suggested by the LLM.
 * Validates against blacklist before execution.
 */
export async function executeRecoveryAction(
    action: RecoveryAction,
    sshHost: string = 'host.docker.internal',
    sshUser: string = 'ubuntu',
    deployDir?: string
): Promise<{ success: boolean; output: string }> {
    const startTime = Date.now();
    logActivityStart('deployer', 'executeRecoveryAction', { action });

    try {
        // Final blacklist validation
        const blacklist = await systemConfigService.getDeployerBlacklist();
        if (action.target && blacklist.includes(action.target)) {
            throw new Error(`Cannot execute action on blacklisted container: ${action.target}`);
        }

        if (action.type === 'escalate') {
            return { success: false, output: 'Escalation required - no automatic action taken' };
        }

        const isLocal = !sshHost || sshHost === 'host.docker.internal' || sshHost === '127.0.0.1' || sshHost === 'localhost';
        const sshTarget = `${sshUser}@${sshHost}`;
        let command: string;

        switch (action.type) {
            case 'restart_container':
                command = isLocal
                    ? `docker restart ${action.target}`
                    : `ssh ${SSH_OPTS} ${sshTarget} "docker restart ${action.target}"`;
                break;
            case 'rebuild_container':
                if (isLocal) {
                    command = deployDir
                        ? `cd ${deployDir} && docker compose build --no-cache ${action.target} && docker compose up -d ${action.target}`
                        : `docker restart ${action.target}`;
                } else {
                    command = deployDir
                        ? `ssh ${SSH_OPTS} ${sshTarget} "cd ${deployDir} && docker compose build --no-cache ${action.target} && docker compose up -d ${action.target}"`
                        : `ssh ${SSH_OPTS} ${sshTarget} "docker restart ${action.target}"`;
                }
                break;
            case 'run_migration':
                command = isLocal
                    ? action.command
                    : (action.command.startsWith('ssh') ? action.command : `ssh ${SSH_OPTS} ${sshTarget} "${action.command}"`);
                break;
            case 'wait_and_retry':
                // Just wait, no action needed
                await new Promise(r => setTimeout(r, 30000));
                return { success: true, output: 'Waited 30 seconds for service recovery' };
            case 'clear_volume':
                command = isLocal
                    ? action.command
                    : `ssh ${SSH_OPTS} ${sshTarget} "${action.command}"`;
                break;
            default:
                throw new Error(`Unknown action type: ${action.type}`);
        }

        logger.info({ command }, 'Executing recovery action');
        const { stdout, stderr } = await execAsync(command, { timeout: 120000 });

        const durationMs = Date.now() - startTime;
        logActivityComplete('deployer', 'executeRecoveryAction', durationMs, true);

        return {
            success: true,
            output: stdout || stderr || 'Action completed successfully'
        };
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('deployer', 'executeRecoveryAction', durationMs, false);

        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg, action }, 'Recovery action failed');
        return { success: false, output: msg };
    }
}
