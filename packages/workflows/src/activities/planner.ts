/**
 * AI Swarm v2 - Planner Activity
 *
 * Creates implementation plans for tasks using Gemini CLI.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

import {
    Task,
    ImplementationPlan,
    PlannerOutput,
    ReviewerOutput,
    invokeGeminiCLI,
    loadSystemPrompt,
    logger,
    logActivityStart,
    logActivityComplete,
    systemConfigService,
    projectService,
} from '@ai-swarm/shared';

/**
 * Plan a task by analyzing requirements and creating an implementation plan.
 */
export async function planTask(input: Task): Promise<ImplementationPlan> {
    const startTime = Date.now();
    // v3.0.0: Temporal activity input can be wrapped in { input: ... }
    const task = (input as any)?.input ? (input as any).input : input;
    logActivityStart('planner', 'planTask', { taskId: task.id, title: task.title });

    try {
        // v3.0.0: Resolve project directory from task.projectId
        let projectDir = process.env.PROJECT_DIR || '/project';
        if (task.projectId) {
            try {
                const project = await projectService.getProjectById(task.projectId);
                if (project && project.projectFolder) {
                    projectDir = project.projectFolder;
                    logger.info({ projectId: task.projectId, projectDir }, 'Resolved project directory');
                }
            } catch (err) {
                logger.warn({ err, projectId: task.projectId }, 'Failed to resolve project, using default');
            }
        }

        const systemPrompt = await loadSystemPrompt('planner');

        const prompt = `${systemPrompt}

## Task to Plan

**ID:** ${task.id}
**Title:** ${task.title}

**Context:**
${task.context}

**Acceptance Criteria:**
${(task.acceptanceCriteria || []).map((c: any, i: number) => `${i + 1}. ${c}`).join('\n')}

**Files to Consider:**
${(task.filesToModify || []).length > 0 ? task.filesToModify.map((f: any) => `- ${f}`).join('\n') : 'Not specified - analyze the codebase to determine.'}

**Priority:** ${task.priority || 'medium'}

---

Analyze this task and create a detailed implementation plan. Return ONLY valid JSON.`;

        const plannerProvider = await systemConfigService.getLLMRole('planner');
        const claudeAuthMode = await systemConfigService.getClaudeAuthMode();
        const zaiApiKey = await systemConfigService.getZaiApiKey();

        let response: string;
        if (plannerProvider === 'claude' && (claudeAuthMode === 'oauth' || (claudeAuthMode === 'zai' && zaiApiKey))) {
            logger.info('Using Claude Code for planning');
            const { executeClaudeCode } = await import('./llm-claude.js');
            const claudeResult = await executeClaudeCode({
                task: prompt,
                projectDir,
                role: 'planner',
            });
            if (!claudeResult.success) throw new Error(`Claude planning failed: ${claudeResult.error}`);
            response = claudeResult.stdout;
        } else {
            logger.info('Using Gemini CLI for planning');
            response = await invokeGeminiCLI(prompt, {
                role: 'planner',
                cwd: projectDir,
            });
        }

        // Parse JSON from response
        const plannerOutput = parseJsonFromResponse<PlannerOutput>(response);

        const plan: ImplementationPlan = {
            taskId: task.id,
            proposedChanges: plannerOutput.proposedChanges,
            verificationPlan: plannerOutput.verificationPlan,
            estimatedEffort: plannerOutput.estimatedEffort,
        };

        const durationMs = Date.now() - startTime;
        logActivityComplete('planner', 'planTask', durationMs, true);

        return plan;
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('planner', 'planTask', durationMs, false);
        throw error;
    }
}

/**
 * Parse JSON from a potentially messy LLM response.
 * Handles both direct JSON responses and Claude's --output-format json wrapper.
 */
function parseJsonFromResponse<T>(response: string): T {
    // First, check if this is Claude's --output-format json wrapper
    // Format: {"type":"result","subtype":"success","result":"<actual response>", ...}
    try {
        const claudeWrapper = JSON.parse(response);
        if (claudeWrapper?.type === 'result' && typeof claudeWrapper?.result === 'string') {
            // The actual LLM response is in the 'result' field
            logger.debug('Detected Claude JSON wrapper, extracting result field');
            const innerResponse = claudeWrapper.result;

            // Now parse the inner JSON
            const innerJsonMatch = innerResponse.match(/\{[\s\S]*\}/);
            if (innerJsonMatch) {
                return JSON.parse(innerJsonMatch[0]) as T;
            }
            logger.error({ innerResponse: innerResponse.slice(0, 500) }, 'No JSON found in Claude result');
            throw new Error('No JSON found in Claude result field');
        }
    } catch (e) {
        // Not a Claude wrapper, continue with normal parsing
    }

    // Try to extract JSON from the response (standard approach)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        logger.error({ response: response.slice(0, 500) }, 'No JSON found in response');
        throw new Error('Failed to parse JSON from Planner response');
    }

    try {
        return JSON.parse(jsonMatch[0]) as T;
    } catch (error) {
        logger.error({ json: jsonMatch[0].slice(0, 500) }, 'Invalid JSON in response');
        throw new Error('Invalid JSON in Planner response');
    }
}

/**
 * Review code changes made by the Coder.
 */
export async function reviewCode(
    taskInput: Task,
    planInput: ImplementationPlan,
    filesChanged: string[],
    providedProjectDir?: string
): Promise<ReviewerOutput> {
    const startTime = Date.now();

    // v3.0.0: Handle potential wrapping (though Temporal usually only wraps the first arg)
    const task = (taskInput as any)?.input ? (taskInput as any).input : taskInput;
    const plan = (planInput as any)?.input ? (planInput as any).input : planInput;

    logActivityStart('planner', 'reviewCode', { taskId: task.id, providedProjectDir });

    const projectDir = providedProjectDir || process.env.PROJECT_DIR || '/project';

    try {
        const systemPrompt = await loadSystemPrompt('reviewer');

        // Extract diff for the changed files
        let diff = '';
        if (filesChanged.length > 0) {
            try {
                const { stdout } = await execAsync(`git diff HEAD~1 -- ${filesChanged.join(' ')}`, { cwd: projectDir });
                diff = stdout;
            } catch (err) {
                logger.warn({ err }, 'Failed to get git diff for reviewer');
                diff = 'Could not retrieve diff. Review based on available context.';
            }
        }

        const prompt = `${systemPrompt}

## Original Task
**Title:** ${task.title}
**Context:** ${task.context}
**Acceptance Criteria:** ${(task.acceptanceCriteria || []).join('\n')}

## Approved Plan
**Plan ID:** ${plan.taskId}
**Proposed Changes:**
${plan.proposedChanges.map((c: any) => `- ${c.action.toUpperCase()} ${c.path}: ${c.description}`).join('\n')}

## Actual Changes (Diff)
\`\`\`diff
${diff || 'No diff available.'}
\`\`\`

---

Review the diff against the original task and the approved plan. Focus on cross-file consistency and naming mismatches. Return ONLY valid JSON.`;

        const reviewerProvider = await systemConfigService.getLLMRole('reviewer');
        const claudeAuthMode = await systemConfigService.getClaudeAuthMode();
        const zaiApiKey = await systemConfigService.getZaiApiKey();

        let response: string;
        if (reviewerProvider === 'claude' && (claudeAuthMode === 'oauth' || (claudeAuthMode === 'zai' && zaiApiKey))) {
            logger.info('Using Claude Code for review');
            const { executeClaudeCode } = await import('./llm-claude.js');
            const claudeResult = await executeClaudeCode({
                task: prompt,
                projectDir,
            });
            if (!claudeResult.success) throw new Error(`Claude review failed: ${claudeResult.error}`);
            response = claudeResult.stdout;
        } else {
            logger.info('Using Gemini CLI for review');
            response = await invokeGeminiCLI(prompt, {
                role: 'planner', // Using planner role/model (Gemini 2.5 Pro) for review
                cwd: projectDir,
            });
        }

        // Parse JSON
        const reviewerOutput = parseJsonFromResponse<ReviewerOutput>(response);

        const durationMs = Date.now() - startTime;
        logActivityComplete('planner', 'reviewCode', durationMs, reviewerOutput.approved);

        return reviewerOutput;
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('planner', 'reviewCode', durationMs, false);
        throw error;
    }
}
