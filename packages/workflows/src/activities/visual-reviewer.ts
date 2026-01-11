/**
 * AI Swarm v3.0.0 - Visual Reviewer Activity
 *
 * Uses LLM vision capabilities to review deployment screenshots.
 * Implements fail-safe pattern: only fails on high-confidence catastrophic issues.
 */

import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync } from 'fs';
import { logger, logActivityStart, logActivityComplete, systemConfigService } from '@ai-swarm/shared';
import { deleteScreenshot } from './playwright-runner.js';

const execAsync = promisify(exec);

// =============================================================================
// TYPES
// =============================================================================

export interface VisualReviewInput {
    url: string;
    screenshotPath: string;  // Path to screenshot file in Playwright container
    screenshotBase64?: string;  // Optional base64 for API fallback
    pageTitle?: string;
    statusCode?: number;
    projectContext?: string;
}

export interface VisualReviewOutput {
    verdict: 'pass' | 'fail';
    confidence: number;  // 1-10
    reason: string;
    shouldFail: boolean;  // true only if verdict=fail AND confidence >= 8
}

// =============================================================================
// VISUAL REVIEW ACTIVITY
// =============================================================================

/**
 * Review a deployment screenshot using LLM vision.
 * 
 * FAIL-SAFE PATTERN:
 * - Returns { shouldFail: false } for ANY uncertainty
 * - Only returns { shouldFail: true } if LLM is highly confident (8+) of catastrophic failure
 * - Any error in the process = pass-through (shouldFail: false)
 * 
 * Cleans up screenshot file after review.
 */
export async function reviewVisualDeployment(input: VisualReviewInput): Promise<VisualReviewOutput> {
    const startTime = Date.now();
    logActivityStart('visual-reviewer', 'reviewVisualDeployment', { url: input.url });

    const defaultPass: VisualReviewOutput = {
        verdict: 'pass',
        confidence: 0,
        reason: 'Visual review skipped or inconclusive',
        shouldFail: false,
    };

    try {
        // Build the prompt
        const prompt = buildVisualReviewPrompt(input);

        // v3.0.1: Respect LLM Settings - deployer role determines visual review provider
        let response: string | null = null;
        const deployerProvider = await systemConfigService.getLLMRole('deployer');

        if (deployerProvider === 'claude') {
            try {
                response = await invokeClaudeWithImage(prompt, input.screenshotPath);
            } catch (claudeError) {
                logger.warn({ error: claudeError }, 'Claude vision failed, trying Gemini fallback');
                try {
                    response = await invokeGeminiWithImage(prompt, input.screenshotPath);
                } catch (geminiError) {
                    logger.warn({ error: geminiError }, 'Gemini vision fallback also failed');
                }
            }
        } else {
            // Default to Gemini (or explicitly selected Gemini)
            try {
                response = await invokeGeminiWithImage(prompt, input.screenshotPath);
            } catch (geminiError) {
                logger.warn({ error: geminiError }, 'Gemini vision failed, trying Claude fallback');
                try {
                    response = await invokeClaudeWithImage(prompt, input.screenshotPath);
                } catch (claudeError) {
                    logger.warn({ error: claudeError }, 'Claude vision fallback also failed');
                }
            }
        }

        // Clean up screenshot regardless of outcome
        if (input.screenshotPath) {
            await deleteScreenshot(input.screenshotPath);
        }

        if (!response || response.trim().length === 0) {
            logger.warn('Visual review returned empty response, passing through');
            return { ...defaultPass, reason: 'LLM returned empty response - no vision support or error' };
        }

        // Parse the response
        const review = parseVisualReviewResponse(response);

        // Apply fail-safe logic: only fail on high confidence catastrophic issues
        const shouldFail = review.verdict === 'fail' && review.confidence >= 8;

        const durationMs = Date.now() - startTime;
        logActivityComplete('visual-reviewer', 'reviewVisualDeployment', durationMs, !shouldFail);

        logger.info({
            verdict: review.verdict,
            confidence: review.confidence,
            shouldFail,
            reason: review.reason
        }, 'Visual review complete');

        return {
            verdict: review.verdict,
            confidence: review.confidence,
            reason: review.reason,
            shouldFail,
        };
    } catch (error: any) {
        // Clean up screenshot on error too
        if (input.screenshotPath) {
            await deleteScreenshot(input.screenshotPath).catch(() => { });
        }

        const durationMs = Date.now() - startTime;
        logActivityComplete('visual-reviewer', 'reviewVisualDeployment', durationMs, true);

        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn({ error: errorMessage }, 'Visual review failed, passing through');
        return { ...defaultPass, reason: `Visual review error: ${errorMessage}` };
    }
}

// =============================================================================
// LLM INVOCATION WITH IMAGES
// =============================================================================

/**
 * Invoke Claude Code CLI with image file.
 * Uses file path reference in prompt.
 */
async function invokeClaudeWithImage(prompt: string, imagePath: string): Promise<string> {
    // Copy image from Playwright container to a shared location
    const tempHostPath = `/tmp/ai-swarm-visual-${Date.now()}.png`;
    const tempPromptPath = `/tmp/ai-swarm-prompt-${Date.now()}.txt`;

    try {
        // Copy from Playwright container to host
        await execAsync(`docker cp ai-swarm-playwright:${imagePath} ${tempHostPath}`, { timeout: 10000 });

        // Build prompt with image reference
        const fullPrompt = `${prompt}\n\nAnalyze this screenshot: ${tempHostPath}`;

        // Write prompt to temp file to avoid shell escaping issues
        writeFileSync(tempPromptPath, fullPrompt);

        // Invoke Claude with -p flag, piping prompt via stdin
        const result = execSync(`cat "${tempPromptPath}" | claude -p`, {
            timeout: 120000,
            maxBuffer: 10 * 1024 * 1024,
            encoding: 'utf-8',
        });

        return result;
    } finally {
        // Clean up temp files
        try { unlinkSync(tempHostPath); } catch { /* ignore */ }
        try { unlinkSync(tempPromptPath); } catch { /* ignore */ }
    }
}

/**
 * Invoke Gemini CLI with image file.
 * Uses @file syntax for image input.
 */
async function invokeGeminiWithImage(prompt: string, imagePath: string): Promise<string> {
    const tempHostPath = `/tmp/ai-swarm-visual-${Date.now()}.png`;
    const tempPromptPath = `/tmp/ai-swarm-prompt-${Date.now()}.txt`;

    try {
        // Copy from Playwright container to host
        await execAsync(`docker cp ai-swarm-playwright:${imagePath} ${tempHostPath}`, { timeout: 10000 });

        // Build prompt with image reference using @ syntax
        const fullPrompt = `@${tempHostPath} ${prompt}`;

        // Write prompt to temp file
        writeFileSync(tempPromptPath, fullPrompt);

        // Invoke Gemini CLI
        // Try both formats: newer versions use @ syntax, older use --media
        try {
            const result = execSync(`gemini < "${tempPromptPath}"`, {
                timeout: 120000,
                maxBuffer: 10 * 1024 * 1024,
                encoding: 'utf-8',
            });
            return result;
        } catch {
            // Fallback to --media flag
            const result = execSync(`gemini --media "${tempHostPath}" < "${tempPromptPath}"`, {
                timeout: 120000,
                maxBuffer: 10 * 1024 * 1024,
                encoding: 'utf-8',
            });
            return result;
        }
    } finally {
        // Clean up temp files
        try { unlinkSync(tempHostPath); } catch { /* ignore */ }
        try { unlinkSync(tempPromptPath); } catch { /* ignore */ }
    }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function buildVisualReviewPrompt(input: VisualReviewInput): string {
    return `You are verifying a web application deployment by reviewing a screenshot.

URL: ${input.url}
Page Title: ${input.pageTitle || 'Unknown'}
HTTP Status: ${input.statusCode || 'Unknown'}
${input.projectContext ? `\nProject Context: ${input.projectContext}` : ''}

## Your Task
Analyze the screenshot and determine if the deployment has a CATASTROPHIC failure.

## Catastrophic Failures (verdict: "fail")
- Visible error pages (500, 503, "Internal Server Error")
- Stack traces or debug output visible on page
- "Something went wrong" or similar error messages
- Completely blank/white pages with no content
- "Cannot connect to database" or similar infrastructure errors
- Obvious crash screens

## NOT Failures (verdict: "pass")
- Normal application content (dashboards, forms, lists)
- Login pages (expected for protected apps)
- "Page not found" for specific routes (navigation issue, not crash)
- Minor styling differences or slow-loading indicators
- Partially loaded content that looks intentional
- Any page that appears to be functioning

## Confidence Guidelines
- 10: Absolutely certain (visible stack trace, 500 error page)
- 8-9: Very confident (clear error message, blank page)
- 5-7: Somewhat confident (something looks off but not certain)
- 1-4: Low confidence (might be fine)

## IMPORTANT
- When in doubt, return verdict: "pass"
- Only return "fail" if you are VERY confident (8+) something is catastrophically wrong
- A working application with minor issues should PASS

## Response Format
Return ONLY valid JSON (no markdown, no explanation):
{"verdict": "pass" | "fail", "confidence": 1-10, "reason": "brief explanation"}`;
}

function parseVisualReviewResponse(response: string): { verdict: 'pass' | 'fail'; confidence: number; reason: string } {
    const defaultResult = { verdict: 'pass' as const, confidence: 0, reason: 'Could not parse response' };

    try {
        // Try to extract JSON from the response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            logger.warn({ response: response.slice(0, 200) }, 'No JSON found in visual review response');
            return defaultResult;
        }

        const parsed = JSON.parse(jsonMatch[0]);

        // Validate the response
        const verdict = parsed.verdict === 'fail' ? 'fail' : 'pass';
        const confidence = typeof parsed.confidence === 'number'
            ? Math.min(10, Math.max(1, parsed.confidence))
            : 0;
        const reason = typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided';

        return { verdict, confidence, reason };
    } catch (parseError) {
        logger.warn({ error: parseError, response: response.slice(0, 200) }, 'Failed to parse visual review JSON');
        return defaultResult;
    }
}
