/**
 * AI Swarm v2 - Develop Feature Workflow
 *
 * Main workflow that orchestrates the full development cycle:
 * Planner → Coder → Deployer → Notification
 *
 * AUTO-APPROVAL MODE: Skips human approval by default for autonomous operation.
 * Uses retry-once logic for test failures before creating fix tasks.
 */

import {
    proxyActivities,
    defineSignal,
    setHandler,
    condition,
    sleep,
    workflowInfo,
} from '@temporalio/workflow';

import type {
    Task,
    ImplementationPlan,
    CoderOutput,
    DeployerOutput,
    ReviewerOutput,
    CleanupInput,
    CleanupOutput
} from '@ai-swarm/shared';
import type * as activities from '../activities/index.js';

// =============================================================================
// ACTIVITY PROXIES
// =============================================================================

const {
    planTask,
    executeCode,
    verifyBuild,
    mergePullRequest,
    deployToProduction,
    verifyDeployment,
    sendNotification,
    rollbackCommit,
    createFixTask,
    checkFixTaskLoop,
    reviewCode,
    cleanupResources,
    createWorktree,
    removeWorktree,
    updateProjectContext,
    // v3.0.0: LLM Deployer activities
    analyzeDeploymentContext,
    troubleshootDeployment,
    executeRecoveryAction,
    getContainerLogs,
} = proxyActivities<typeof activities>({
    startToCloseTimeout: '15 minutes',
    retry: {
        maximumAttempts: 3,
        initialInterval: '5s',
        backoffCoefficient: 2,
        maximumInterval: '2m',
    },
});

// =============================================================================
// SIGNALS
// =============================================================================

/**
 * Signal to approve or reject the implementation plan.
 */
export const approvalSignal = defineSignal<[boolean, string?]>('approval');

/**
 * Signal to cancel the workflow.
 */
export const cancelSignal = defineSignal('cancel');

// =============================================================================
// WORKFLOW STATE
// =============================================================================

interface WorkflowState {
    phase: 'planning' | 'awaiting_approval' | 'coding' | 'deploying' | 'retrying' | 'complete' | 'failed' | 'cancelled';
    plan?: ImplementationPlan;
    prUrl?: string;
    commitSha?: string;
    approvalStatus?: 'pending' | 'approved' | 'rejected';
    approvalComment?: string;
    error?: string;
    retryCount: number;
    worktreePath?: string;
}

// =============================================================================
// MAIN WORKFLOW
// =============================================================================

export interface DevelopFeatureInput {
    task: Task;
    skipApproval?: boolean;  // Default: TRUE for autonomous mode
    notifyOnComplete?: boolean;
    isFixTask?: boolean;
    originalTaskId?: string;
}

export interface DevelopFeatureOutput {
    status: 'completed' | 'failed' | 'cancelled' | 'fix_task_created' | 'completed_with_errors';
    prUrl?: string;
    plan?: ImplementationPlan;
    commitSha?: string;
    error?: string;
    fixTaskId?: string;
}

/**
 * Develop Feature Workflow
 *
 * Orchestrates the full development cycle with autonomous operation.
 * Auto-approves by default. Retries once on failure, then creates fix task.
 */
export async function developFeature(
    input: DevelopFeatureInput
): Promise<DevelopFeatureOutput> {
    // AUTO-APPROVAL: Default to true for autonomous operation
    const {
        task,
        skipApproval = true,  // Changed default to TRUE
        notifyOnComplete = true,
        isFixTask = false,
        originalTaskId,
    } = input;

    const { workflowId } = workflowInfo();

    // Workflow state
    const state: WorkflowState = {
        phase: 'planning',
        approvalStatus: 'pending',
        retryCount: 0,
    };

    let cancelled = false;

    // ==========================================================================
    // SIGNAL HANDLERS
    // ==========================================================================

    setHandler(approvalSignal, (approved: boolean, comment?: string) => {
        state.approvalStatus = approved ? 'approved' : 'rejected';
        state.approvalComment = comment;
    });

    setHandler(cancelSignal, () => {
        cancelled = true;
        state.phase = 'cancelled';
    });

    try {
        // ========================================================================
        // CHECK FOR LOOP (Fix tasks only)
        // ========================================================================
        if (isFixTask && originalTaskId) {
            const loopCheck = await checkFixTaskLoop(originalTaskId);
            if (loopCheck.isLoop) {
                // ROLLBACK: Revert the broken code before escalating
                console.warn(`[LOOP DETECTED] Reverting changes after ${loopCheck.chainDepth} failed fix attempts...`);

                // Try to rollback if we have a commit SHA in the task context
                // The original commit that started this chain should be rolled back
                try {
                    // Get the most recent commit SHA from git
                    // This ensures we're rolling back the broken state
                    await rollbackCommit({
                        commitSha: 'HEAD',
                        reason: `Fix-task loop detected after ${loopCheck.chainDepth} attempts`,
                    });
                    console.warn('[LOOP DETECTED] Successfully rolled back broken code.');
                } catch (rollbackError) {
                    console.warn(`[LOOP DETECTED] Rollback failed: ${rollbackError}`);
                    // Continue to notify even if rollback fails
                }

                // Escalate to human
                await sendNotification({
                    subject: `[AI Swarm] 🔄 LOOP DETECTED - Rolled Back: ${task.title}`,
                    body: `
Fix-task loop detected! Task has failed ${loopCheck.chainDepth} times.

**Original Task ID:** ${originalTaskId}
**Task:** ${task.title}
**Chain Depth:** ${loopCheck.chainDepth}

**Automatic Action Taken:**
The broken code has been rolled back to the previous working state.

**Action Required:** Manual intervention needed. The automated fix attempts are failing repeatedly.

Please review the task and either:
1. Fix the underlying issue manually
2. Cancel the task chain
          `.trim(),
                    priority: 'high',
                });

                return {
                    status: 'failed',
                    error: `Fix-task loop detected after ${loopCheck.chainDepth} attempts. Code rolled back. Escalated to human.`,
                };
            }
        }

        // ========================================================================
        // PHASE 1: PLANNING
        // ========================================================================
        state.phase = 'planning';

        const plan = await planTask(task);
        state.plan = plan;

        // Check for cancellation
        if (cancelled) {
            return { status: 'cancelled' };
        }

        // ========================================================================
        // PHASE 2: HUMAN APPROVAL (Skip in auto mode)
        // ========================================================================
        if (!skipApproval) {
            state.phase = 'awaiting_approval';

            // Notify user that plan is ready for review
            await sendNotification({
                subject: `[AI Swarm] Plan Ready: ${task.title}`,
                body: `
Implementation plan is ready for review.

**Task:** ${task.title}
**Workflow ID:** ${workflowId}

**Proposed Changes:**
${plan.proposedChanges.map((c) => `- ${c.action.toUpperCase()} ${c.path}: ${c.description}`).join('\n')}

**Verification Plan:**
${plan.verificationPlan}

**Estimated Effort:** ${plan.estimatedEffort}

Reply to this workflow to approve or reject.
        `.trim(),
                priority: 'high',
            });

            // Wait for approval (max 24 hours)
            const gotApproval = await condition(
                () => state.approvalStatus !== 'pending' || cancelled,
                '24h'
            );

            if (cancelled) {
                return { status: 'cancelled' };
            }

            if (!gotApproval || state.approvalStatus === 'pending') {
                state.phase = 'failed';
                state.error = 'Plan not approved within 24 hours';
                return {
                    status: 'failed',
                    plan,
                    error: state.error,
                };
            }

            if (state.approvalStatus === 'rejected') {
                state.phase = 'failed';
                state.error = `Plan rejected: ${state.approvalComment || 'No reason given'}`;
                return {
                    status: 'failed',
                    plan,
                    error: state.error,
                };
            }
        }

        // ========================================================================
        // PHASE 3: WORKTREE SETUP (NEW)
        // ========================================================================
        state.phase = 'coding';

        const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
        // v3.0.0: Pass projectId for multi-project support
        const worktree = await createWorktree(task.id, task.type || 'feature', slug, task.projectId);
        state.worktreePath = worktree.path;

        // ========================================================================
        // PHASE 4: CODING with ATOMIC SELF-CORRECTION
        // ========================================================================
        state.phase = 'coding';

        let codingAttempts = 0;
        const maxCodingAttempts = 3;
        let lastCodingError: string | undefined;
        let coderResult: CoderOutput | undefined;

        while (codingAttempts < maxCodingAttempts) {
            codingAttempts++;

            // Update plan with error context if this is a retry
            const currentPlan = lastCodingError
                ? {
                    ...plan,
                    verificationPlan: `${plan.verificationPlan}\n\n**PREVIOUS ERROR (fix this):**\n${lastCodingError}`,
                }
                : plan;

            coderResult = await executeCode({
                ...currentPlan,
                projectId: task.projectId,
                context: `${plan.context || ''}\n\n**WORKTREE PATH:** ${state.worktreePath}`,
            });

            if (coderResult.error) {
                lastCodingError = coderResult.error;
                // console.warn is safe in Temporal
                console.warn(`Coding failed local verification (attempt ${codingAttempts}), retrying atomic fix: ${lastCodingError}`);
                continue;
            }

            // If we get here, local syntax passed. Now run Shadow Review.
            state.phase = 'coding'; // Stay in coding phase for review
            const reviewResult: ReviewerOutput = await reviewCode(task, plan, coderResult.filesChanged, state.worktreePath);

            if (!reviewResult.approved) {
                lastCodingError = `REVIEW ISSUES:\n${reviewResult.issues.join('\n')}\n\nSUGGESTIONS:\n${reviewResult.fixSuggestions}`;
                console.warn(`Shadow Reviewer rejected code (attempt ${codingAttempts}), retrying atomic fix`);
                continue;
            }

            // Both build and review passed!
            // v3.0.0: Update project context (intelligent .aicontext updates)
            // Note: UPDATE_PROJECT_CONTEXT check removed - process.env not allowed in Temporal workflow sandbox
            if (state.worktreePath) {
                try {
                    await updateProjectContext({
                        taskId: task.id,
                        projectDir: state.worktreePath,
                        taskDescription: task.context,
                        changedFiles: coderResult.filesChanged || [],
                    });
                } catch (contextError) {
                    console.warn('Failed to update project context, continuing...', contextError);
                }
            }
            break;
        }

        if (!coderResult || coderResult.error || (codingAttempts >= maxCodingAttempts && lastCodingError)) {
            state.phase = 'failed';
            state.error = `Coding failed after ${codingAttempts} attempts. Final error: ${lastCodingError}`;

            // CLEANUP on failure
            if (state.worktreePath) {
                await removeWorktree(state.worktreePath, true);
            }
            await cleanupResources({ prUrl: coderResult?.prUrl, branchName: `feature/task-${task.id}` });

            return {
                status: 'failed',
                error: state.error,
            };
        }

        state.prUrl = coderResult.prUrl;
        state.commitSha = coderResult.commitSha;

        if (cancelled) {
            await cleanupResources({ prUrl: coderResult.prUrl, branchName: `feature/task-${task.id}` });
            return { status: 'cancelled', prUrl: coderResult.prUrl };
        }

        // ========================================================================
        // PHASE 4: DEPLOYMENT VERIFICATION (with retry)
        // ========================================================================
        state.phase = 'deploying'; // This is now 'Syntax Verification'

        let deployResult: DeployerOutput = await verifyBuild(coderResult.prUrl, task.projectId, state.worktreePath);

        // RETRY ONCE if tests fail
        if (!deployResult.buildSuccess || !deployResult.testsPassed) {
            state.phase = 'retrying';
            state.retryCount = 1;

            // Wait a bit and retry
            await sleep('30s');

            deployResult = await verifyBuild(coderResult.prUrl, task.projectId, state.worktreePath);
        }

        // If still failing after retry, create fix task
        if (!deployResult.buildSuccess || !deployResult.testsPassed) {
            state.phase = 'failed';
            state.error = `Build/test verification failed: ${deployResult.logs}`;

            // Create a fix task
            const fixResult = await createFixTask({
                originalTaskId: originalTaskId || task.id,
                originalTaskTitle: task.title,
                error: state.error,
                commitSha: coderResult.commitSha,
            });

            await sendNotification({
                subject: `[AI Swarm] Task Failed - Fix Task Created: ${task.title}`,
                body: `
Task failed verification. A fix task has been created.

**Original Task:** ${task.title}
**PR:** ${coderResult.prUrl}
**Error:** ${state.error}

**Fix Task ID:** ${fixResult.fixTaskId}
**Attempt:** ${fixResult.chainDepth}

The fix task will run automatically.
        `.trim(),
                priority: 'high',
            });

            return {
                status: 'fix_task_created',
                prUrl: coderResult.prUrl,
                plan,
                error: state.error,
                fixTaskId: fixResult.fixTaskId,
            };
        }

        // ========================================================================
        // PHASE 5: MERGE PR (squash merge + delete branch)
        // ========================================================================
        state.phase = 'merging' as WorkflowState['phase'];

        const mergeResult = await mergePullRequest({
            prUrl: coderResult.prUrl,
            mergeMethod: 'squash',
            deleteBranch: true,
            projectId: task.projectId,
        });

        // ========================================================================
        // PHASE 6: DEPLOY TO PRODUCTION (if DEPLOY_DIR is configured)
        // ========================================================================
        let prodDeployResult: { success: boolean; mode: string; logs: string; error?: string } | null = null;
        let rollbackTriggered = false;

        if (mergeResult.success) {
            try {
                // v3.0.0: LLM Deployer - Pre-deployment analysis
                const deploymentAnalysis = await analyzeDeploymentContext({
                    projectId: task.projectId || '',
                    deployDir: state.worktreePath || '',
                    changedFiles: coderResult.filesChanged || [],
                });
                console.log(`[LLM DEPLOYER] Analysis: ${deploymentAnalysis.analysis}`);
                if (deploymentAnalysis.risks.length > 0) {
                    console.warn(`[LLM DEPLOYER] Risks identified: ${deploymentAnalysis.risks.join(', ')}`);
                }

                // v3.0.0: LLM Deployer - Deploy with intelligent retry loop
                let deployAttempt = 0;
                const maxDeployAttempts = 3;
                let lastDeployError: string | undefined;

                while (deployAttempt < maxDeployAttempts) {
                    deployAttempt++;
                    console.log(`[LLM DEPLOYER] Deployment attempt ${deployAttempt}/${maxDeployAttempts}`);

                    prodDeployResult = await deployToProduction({
                        projectId: task.projectId,
                        commitSha: mergeResult.mergeCommitSha,
                        providedProjectDir: state.worktreePath
                    });

                    if (prodDeployResult.success) {
                        // Deployment succeeded - proceed to verification
                        break;
                    }

                    // Deployment failed - use LLM to troubleshoot
                    lastDeployError = prodDeployResult.error || prodDeployResult.logs;
                    console.warn(`[LLM DEPLOYER] Deployment failed, invoking troubleshooter...`);

                    const troubleshootResult = await troubleshootDeployment({
                        projectId: task.projectId || '',
                        error: lastDeployError,
                        logs: prodDeployResult.logs,
                        attemptNumber: deployAttempt,
                    });

                    console.log(`[LLM DEPLOYER] Error type: ${troubleshootResult.errorType}`);

                    // CODE ERROR: Don't retry deployment, kick back to Coder
                    if (troubleshootResult.errorType === 'code') {
                        console.warn(`[LLM DEPLOYER] Code error detected - sending back to Coder`);

                        // Create fix task with LLM summary (not full logs)
                        const fixResult = await createFixTask({
                            originalTaskId: originalTaskId || task.id,
                            originalTaskTitle: task.title,
                            error: `CODE ERROR (from Deployer):\n${troubleshootResult.errorSummary}`,
                            commitSha: coderResult.commitSha,
                        });

                        await sendNotification({
                            subject: `[AI Swarm] Code Error During Deployment: ${task.title}`,
                            body: `
Deployment failed due to a code error. A fix task has been created for the Coder.

**Task:** ${task.title}
**Error Summary:** ${troubleshootResult.errorSummary}
**Analysis:** ${troubleshootResult.analysis}

**Fix Task ID:** ${fixResult.fixTaskId}
                            `.trim(),
                            priority: 'high',
                        });

                        return {
                            status: 'fix_task_created',
                            prUrl: coderResult.prUrl,
                            plan,
                            error: troubleshootResult.errorSummary,
                            fixTaskId: fixResult.fixTaskId,
                        };
                    }

                    // INFRASTRUCTURE ERROR: Try recovery action
                    if (troubleshootResult.errorType === 'infrastructure' && troubleshootResult.suggestedAction) {
                        const action = troubleshootResult.suggestedAction;

                        if (action.type === 'escalate') {
                            console.warn(`[LLM DEPLOYER] Escalation required - breaking retry loop`);
                            break;
                        }

                        console.log(`[LLM DEPLOYER] Executing recovery action: ${action.type} on ${action.target}`);
                        const recoveryResult = await executeRecoveryAction(action);

                        if (recoveryResult.success) {
                            console.log(`[LLM DEPLOYER] Recovery action succeeded, retrying deployment...`);
                            await sleep('10s');
                            continue;
                        } else {
                            console.warn(`[LLM DEPLOYER] Recovery action failed: ${recoveryResult.output}`);
                        }
                    }

                    // Unknown error or failed recovery - wait and retry
                    if (deployAttempt < maxDeployAttempts) {
                        console.log(`[LLM DEPLOYER] Waiting before retry...`);
                        await sleep('30s');
                    }
                }

                // If we exhausted retries without success, escalate
                if (!prodDeployResult?.success && deployAttempt >= maxDeployAttempts) {
                    console.warn(`[LLM DEPLOYER] Exhausted ${maxDeployAttempts} attempts, escalating to human`);

                    await sendNotification({
                        subject: `[AI Swarm] Deployment Failed After ${maxDeployAttempts} Attempts: ${task.title}`,
                        body: `
Deployment failed after ${maxDeployAttempts} automated recovery attempts.

**Task:** ${task.title}
**Last Error:** ${lastDeployError?.slice(-500) || 'Unknown'}

**Action Required:** Manual intervention needed.
                        `.trim(),
                        priority: 'high',
                    });

                    return {
                        status: 'failed',
                        prUrl: coderResult.prUrl,
                        plan,
                        error: `Deployment failed after ${maxDeployAttempts} attempts: ${lastDeployError}`,
                    };
                }

                // POST-DEPLOYMENT VERIFICATION (Production)
                if (prodDeployResult && prodDeployResult.success) {
                    const liveVerifyResult = await verifyDeployment({
                        projectId: task.projectId,
                        expectedCommit: mergeResult.mergeCommitSha
                    });
                    prodDeployResult.logs += `\n\n--- LIVE VERIFICATION ---\n${liveVerifyResult.logs}`;

                    if (liveVerifyResult.success) {
                        // SUCCESS: Tag the deployment
                        // NOTE: Git tagging should be done via an activity, not directly in workflow
                        // TODO: Create a tagDeployment activity
                        prodDeployResult.logs += `\n✓ Deployment verified successfully`;
                    } else {
                        prodDeployResult.success = false;
                        prodDeployResult.error = 'Live verification failed after deployment';
                        rollbackTriggered = true;

                        // 1. ROLLBACK: Revert merge commit on GitHub
                        console.warn(`[ROLLBACK] Live verification failed. Reverting merge commit...`);
                        await rollbackCommit({
                            commitSha: coderResult.commitSha,
                            reason: 'Live verification failed after deployment'
                        });

                        // 2. RESTORATION: Redeploy the previous working code
                        console.warn(`[RESTORATION] Redeploying previous production state...`);
                        await deployToProduction({
                            projectId: task.projectId
                        });

                        // 3. FIX LOOP: Create fix task from runtime error
                        const fixResult = await createFixTask({
                            originalTaskId: originalTaskId || task.id,
                            originalTaskTitle: task.title,
                            error: `PRODUCTION RUNTIME ERROR:\n${liveVerifyResult.logs}`,
                            commitSha: coderResult.commitSha,
                        });

                        await sendNotification({
                            subject: `[AI Swarm] 🚨 ROLLBACK: ${task.title}`,
                            body: `
Live verification failed after deployment. The merge has been rolled back and the previous production state restored.

**Task:** ${task.title}
**Error:** ${liveVerifyResult.logs.slice(-500)}

**Fix Task Created:** ${fixResult.fixTaskId}
A new workflow has been started to address this runtime issue.
        `.trim(),
                            priority: 'high',
                        });

                        return {
                            status: 'fix_task_created',
                            prUrl: coderResult.prUrl,
                            plan,
                            error: prodDeployResult.error,
                            fixTaskId: fixResult.fixTaskId,
                        };
                    }
                }
            } catch (e) {
                // Deployment is optional - don't fail the workflow if it fails
                prodDeployResult = {
                    success: false,
                    mode: 'unknown',
                    logs: '',
                    error: e instanceof Error ? e.message : String(e),
                };
            }
        }

        // ========================================================================
        // PHASE 7: COMPLETION
        // ========================================================================
        state.phase = 'complete';

        if (notifyOnComplete) {
            const mergeInfo = mergeResult.success
                ? `**Merged:** ✅ Squash merged to main\n**Merge Commit:** ${mergeResult.mergeCommitSha || 'N/A'}\n**Branch Deleted:** ${mergeResult.branchDeleted ? 'Yes' : 'No'}`
                : `**Merge:** ⚠️ PR left open (merge failed: ${mergeResult.error})`;
            // ========================================================================
            // FINAL NOTIFICATION
            // ========================================================================

            // Deployment Attempted but Failed (or was skipped/crashed)
            // Condition: Merged successfully, BUT deployment result is missing or failed
            if (mergeResult.success && (!prodDeployResult || !prodDeployResult.success)) {
                const deployError = prodDeployResult?.error || 'Deployment failed or was skipped unexpectedly.';
                const deployLogs = prodDeployResult?.logs?.slice(-1000) || 'No deployment logs available.';

                await sendNotification({
                    subject: `[AI Swarm] ⚠️ Merged but Deployment Failed: ${task.title}`,
                    body: `
The task code was merged successfully, but the automatic deployment to production failed.

**Task:** ${task.title}
**PR:** ${coderResult.prUrl}
**Commit:** ${coderResult.commitSha}

**Deployment Error:**
${deployError}

**Logs:**
${deployLogs}

**Action Required:**
1. Check the production server logs.
2. Manually redeploy or revert if necessary.
            `.trim(),
                    priority: 'high',
                });

                return {
                    status: 'completed_with_errors',
                    prUrl: coderResult.prUrl,
                    plan,
                    error: deployError,
                };
            }

            if (mergeResult.success && prodDeployResult?.success) {
                await sendNotification({
                    subject: `[AI Swarm] ✅ Task Completed & Deployed: ${task.title}`,
                    body: `
Task successfully implemented, merged, and deployed to production.

**Task:** ${task.title}
**PR:** ${coderResult.prUrl}
**Commit:** ${coderResult.commitSha}

**Verification:**
${prodDeployResult?.logs ? 'Live verification passed.' : 'Syntax checks passed.'}
            `.trim(),
                    priority: 'normal',
                });
            }
        }

        // FINAL CLEANUP on success
        if (state.worktreePath) {
            await removeWorktree(state.worktreePath);
        }

        return {
            status: 'completed',
            prUrl: coderResult.prUrl,
            plan,
            commitSha: mergeResult.mergeCommitSha || coderResult.commitSha,
        };
    } catch (error) {
        state.phase = 'failed';
        state.error = error instanceof Error ? error.message : String(error);

        // CLEANUP on expected failure if PR exists
        if (state.worktreePath) {
            await removeWorktree(state.worktreePath, true).catch(() => { });
        }
        if (state.prUrl || (state.phase as string) === 'coding') {
            await cleanupResources({
                prUrl: state.prUrl,
                branchName: `feature/task-${task.id}`
            }).catch(() => { }); // Ignore cleanup errors in failure path
        }

        // Notify on failure
        await sendNotification({
            subject: `[AI Swarm] Task Failed: ${task.title}`,
            body: `
Task failed unexpectedly.

**Task:** ${task.title}
**Phase:** ${state.phase}
**Error:** ${state.error}
      `.trim(),
            priority: 'high',
        });

        return {
            status: 'failed',
            plan: state.plan,
            error: state.error,
        };
    }
}
