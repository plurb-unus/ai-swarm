/**
 * AI Swarm v2 - Playwright Tester Activity
 *
 * Provides browser-based testing using Chromium.
 */

import { chromium, Browser, Page } from 'playwright';
import {
    logger,
    logActivityStart,
    logActivityComplete,
} from '@ai-swarm/shared';

export interface BrowserTestInput {
    url: string;
    task?: string;
    expectedText?: string;
    timeoutMs?: number;
}

export interface BrowserTestOutput {
    success: boolean;
    screenshotPath?: string;
    logs: string;
    error?: string;
}

/**
 * Execute a browser test using Playwright.
 */
export async function runBrowserTest(input: BrowserTestInput): Promise<BrowserTestOutput> {
    const startTime = Date.now();
    logActivityStart('tester', 'runBrowserTest', { url: input.url });

    const logs: string[] = [];
    let browser: Browser | null = null;

    try {
        logs.push(`Starting Chromium for URL: ${input.url}`);
        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const context = await browser.newContext();
        const page = await context.newPage();

        // Navigate to URL
        logs.push(`Navigating to ${input.url}...`);
        await page.goto(input.url, {
            waitUntil: 'networkidle',
            timeout: input.timeoutMs || 30000,
        });

        const title = await page.title();
        logs.push(`Page title: ${title}`);

        // If specific text is expected, verify it
        if (input.expectedText) {
            logs.push(`Verifying expected text: "${input.expectedText}"`);
            const content = await page.content();
            if (!content.includes(input.expectedText)) {
                throw new Error(`Expected text "${input.expectedText}" not found on page`);
            }
            logs.push('✓ Expected text found');
        }

        // Optional: Perform a specific task if provided (basic automation)
        // This could be extended with more complex logic
        if (input.task) {
            logs.push(`Attempting task: ${input.task}`);
            // Simple keyword-based automation or just a placeholder for now
        }

        const durationMs = Date.now() - startTime;
        logActivityComplete('tester', 'runBrowserTest', durationMs, true);

        await browser.close();

        return {
            success: true,
            logs: logs.join('\n'),
        };
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('tester', 'runBrowserTest', durationMs, false);

        const errorMessage = error instanceof Error ? error.message : String(error);
        logs.push(`✗ Error: ${errorMessage}`);

        if (browser) {
            await browser.close().catch(() => { });
        }

        return {
            success: false,
            logs: logs.join('\n'),
            error: errorMessage,
        };
    }
}
