/**
 * AI Swarm v3.0.0 - Playwright Runner Activity
 *
 * Runs browser tests in the persistent Playwright service container.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger, logActivityStart, logActivityComplete } from '@ai-swarm/shared';

const execAsync = promisify(exec);

export interface PlaywrightTestInput {
    url: string;
    testScript?: string;
    expectedText?: string;
    timeoutMs?: number;
}

export interface PlaywrightTestOutput {
    success: boolean;
    logs: string;
    screenshotPath?: string;
    error?: string;
}

const PLAYWRIGHT_CONTAINER = 'ai-swarm-playwright';
const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Run Playwright tests in the persistent Playwright service.
 * Uses docker exec to run tests in the already-running container.
 */
export async function runPlaywrightTest(input: PlaywrightTestInput): Promise<PlaywrightTestOutput> {
    const startTime = Date.now();
    logActivityStart('tester', 'runPlaywrightTest', { url: input.url });

    const timeout = input.timeoutMs || DEFAULT_TIMEOUT_MS;

    try {
        // Build environment variables for the test
        const envParts: string[] = [];
        envParts.push(`-e TARGET_URL=${input.url}`);
        if (input.expectedText) {
            envParts.push(`-e EXPECTED_TEXT=${input.expectedText}`);
        }
        const envString = envParts.join(' ');

        const testFile = input.testScript || 'smoke.spec.ts';
        const cmd = `docker exec ${envString} ${PLAYWRIGHT_CONTAINER} npx playwright test ${testFile} --reporter=line`;

        logger.info({ cmd, url: input.url }, 'Running Playwright test');

        const { stdout, stderr } = await execAsync(cmd, { timeout });

        const logs = stdout + (stderr ? `\nSTDERR: ${stderr}` : '');
        const durationMs = Date.now() - startTime;
        logActivityComplete('tester', 'runPlaywrightTest', durationMs, true);

        return {
            success: true,
            logs,
        };
    } catch (error: any) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('tester', 'runPlaywrightTest', durationMs, false);

        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage, url: input.url }, 'Playwright test failed');

        return {
            success: false,
            logs: error.stdout || '',
            error: errorMessage,
        };
    }
}

/**
 * Run a simple URL accessibility check using Playwright.
 */
export async function checkUrlAccessible(url: string, expectedStatus: number = 200): Promise<boolean> {
    const startTime = Date.now();
    logActivityStart('tester', 'checkUrlAccessible', { url, expectedStatus });

    try {
        // Simple node script to check URL
        const checkScript = `
            const { chromium } = require('playwright');
            (async () => {
                const browser = await chromium.launch();
                const page = await browser.newPage();
                const response = await page.goto('${url}');
                console.log(response.status());
                await browser.close();
                process.exit(response.status() === ${expectedStatus} ? 0 : 1);
            })();
        `;

        const cmd = `docker exec -e NODE_PATH=/tests/node_modules ${PLAYWRIGHT_CONTAINER} node -e "${checkScript.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`;
        await execAsync(cmd, { timeout: 30000 });

        const durationMs = Date.now() - startTime;
        logActivityComplete('tester', 'checkUrlAccessible', durationMs, true);
        return true;
    } catch {
        const durationMs = Date.now() - startTime;
        logActivityComplete('tester', 'checkUrlAccessible', durationMs, false);
        return false;
    }
}

/**
 * Check if the Playwright container is running and healthy.
 */
export async function isPlaywrightHealthy(): Promise<boolean> {
    try {
        const { stdout } = await execAsync(
            `docker inspect --format='{{.State.Running}}' ${PLAYWRIGHT_CONTAINER}`,
            { timeout: 5000 }
        );
        return stdout.trim() === 'true';
    } catch {
        return false;
    }
}

// =============================================================================
// SCREENSHOT CAPTURE (v3.0.0 - Visual Verification)
// =============================================================================

const SCREENSHOT_DIR = '/tmp/ai-swarm-screenshots';

export interface ScreenshotResult {
    success: boolean;
    filePath?: string;      // Path to screenshot file (for file-based LLM input)
    base64?: string;        // Base64 encoded (for API-based input)
    title?: string;
    statusCode?: number;
    error?: string;
}

/**
 * Clean up old screenshots (older than 1 hour).
 * Safe to call on startup or periodically.
 */
export async function cleanupOldScreenshots(): Promise<void> {
    try {
        // Create dir if not exists, then find and delete old files
        const cleanupScript = `
            mkdir -p ${SCREENSHOT_DIR};
            find ${SCREENSHOT_DIR} -name "*.png" -mmin +60 -delete 2>/dev/null || true;
            find ${SCREENSHOT_DIR} -name "*.png" | wc -l;
        `;
        const { stdout } = await execAsync(`docker exec ${PLAYWRIGHT_CONTAINER} sh -c '${cleanupScript}'`, { timeout: 10000 });
        const remaining = parseInt(stdout.trim()) || 0;
        if (remaining > 0) {
            logger.debug({ remaining }, 'Screenshots remaining after cleanup');
        }
    } catch (error) {
        // Non-fatal - cleanup is best-effort
        logger.debug({ error }, 'Screenshot cleanup failed (non-fatal)');
    }
}

/**
 * Delete a specific screenshot file.
 */
export async function deleteScreenshot(filePath: string): Promise<void> {
    try {
        await execAsync(`docker exec ${PLAYWRIGHT_CONTAINER} rm -f "${filePath}"`, { timeout: 5000 });
    } catch (error) {
        logger.debug({ error, filePath }, 'Failed to delete screenshot (non-fatal)');
    }
}

/**
 * Capture a screenshot of a URL for visual verification.
 * Saves to temp file and returns file path + base64 for flexibility.
 * Caller should call deleteScreenshot() after processing.
 */
export async function captureScreenshotAsBase64(url: string): Promise<ScreenshotResult> {
    const startTime = Date.now();
    logActivityStart('tester', 'captureScreenshotAsBase64', { url });

    // Generate unique filename
    const screenshotId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const screenshotPath = `${SCREENSHOT_DIR}/${screenshotId}.png`;
    const scriptPath = `/tmp/screenshot-${screenshotId}.js`;

    try {
        // Build the script content (using double quotes for JSON compatibility)
        const scriptContent = `
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    try {
        fs.mkdirSync('${SCREENSHOT_DIR}', { recursive: true });
        
        const browser = await chromium.launch();
        const page = await browser.newPage();
        const response = await page.goto('${url}', { timeout: 30000, waitUntil: 'domcontentloaded' });
        const statusCode = response ? response.status() : 0;
        const title = await page.title();
        
        await page.screenshot({ path: '${screenshotPath}', fullPage: false });
        
        const buffer = fs.readFileSync('${screenshotPath}');
        const base64 = buffer.toString('base64');
        
        await browser.close();
        console.log(JSON.stringify({ success: true, filePath: '${screenshotPath}', base64, title, statusCode }));
    } catch (err) {
        console.log(JSON.stringify({ success: false, error: err.message }));
    }
})();
`;

        // Use base64 encoding to avoid all shell escaping issues
        const base64Script = Buffer.from(scriptContent).toString('base64');
        await execAsync(
            `docker exec ${PLAYWRIGHT_CONTAINER} sh -c 'echo "${base64Script}" | base64 -d > ${scriptPath}'`,
            { timeout: 10000 }
        );

        // Execute the script (NODE_PATH ensures playwright module is found)
        const { stdout } = await execAsync(
            `docker exec -e NODE_PATH=/tests/node_modules ${PLAYWRIGHT_CONTAINER} node ${scriptPath}`,
            { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }
        );

        // Clean up script file
        await execAsync(`docker exec ${PLAYWRIGHT_CONTAINER} rm -f ${scriptPath}`, { timeout: 5000 }).catch(() => { });

        const result = JSON.parse(stdout.trim());
        const durationMs = Date.now() - startTime;
        logActivityComplete('tester', 'captureScreenshotAsBase64', durationMs, result.success);

        return result;
    } catch (error: any) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('tester', 'captureScreenshotAsBase64', durationMs, false);

        // Clean up script file on error
        await execAsync(`docker exec ${PLAYWRIGHT_CONTAINER} rm -f ${scriptPath}`, { timeout: 5000 }).catch(() => { });

        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage, url }, 'Screenshot capture failed');

        return {
            success: false,
            error: errorMessage,
        };
    }
}

// =============================================================================
// AUTHENTICATED SCREENSHOT (v3.0.0 - Form Login for External Apps)
// =============================================================================

export interface AuthenticatedScreenshotInput {
    url: string;
    testUserEmail?: string;
    testUserPassword?: string;
}

/**
 * Capture a screenshot of a protected page by authenticating first.
 * Uses email/password form login for external applications.
 * 
 * Flow:
 * 1. Navigate to target URL
 * 2. If redirected to login, fill in email/password form
 * 3. Submit and wait for redirect
 * 4. Navigate to target page and capture screenshot
 * 
 * Requires test_user_email and test_user_password in system config
 */
export async function captureAuthenticatedScreenshot(input: AuthenticatedScreenshotInput): Promise<ScreenshotResult> {
    const startTime = Date.now();
    logActivityStart('tester', 'captureAuthenticatedScreenshot', { url: input.url });

    // Generate unique filename
    const screenshotId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const screenshotPath = `${SCREENSHOT_DIR}/${screenshotId}.png`;

    try {
        // Get test credentials from system config
        const { systemConfigService } = await import('@ai-swarm/shared');
        const testCreds = await systemConfigService.getTestCredentials();
        const email = input.testUserEmail || testCreds.email;
        const password = input.testUserPassword || testCreds.password;

        if (!email || !password) {
            logger.warn('No test credentials configured (need both email and password), falling back to unauthenticated screenshot');
            return captureScreenshotAsBase64(input.url);
        }

        logger.info({ email, targetUrl: input.url }, 'Attempting form-based login for authenticated screenshot');

        // Build script that handles form login
        // Uses common selectors for login forms
        const captureScript = `
            const { chromium } = require('playwright');
            const fs = require('fs');
            (async () => {
                try {
                    // Ensure screenshot directory exists
                    fs.mkdirSync('${SCREENSHOT_DIR}', { recursive: true });
                    
                    const browser = await chromium.launch();
                    const context = await browser.newContext();
                    const page = await context.newPage();
                    
                    // Step 1: Navigate to target URL (may redirect to login)
                    console.error('Navigating to target URL: ${input.url}');
                    await page.goto('${input.url}', { timeout: 30000, waitUntil: 'domcontentloaded' });
                    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                    
                    const currentUrl = page.url();
                    console.error('Current URL:', currentUrl);
                    
                    // Step 2: Check if we're on a login page and need to authenticate
                    // Look for common email/password input patterns
                    const loginSelectors = {
                        email: 'input[type="email"], input[name="email"], input[id*="email"], input[placeholder*="email" i]',
                        password: 'input[type="password"], input[name="password"], input[id*="password"]',
                        submit: 'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")'
                    };
                    
                    const emailInput = await page.$(loginSelectors.email);
                    const passwordInput = await page.$(loginSelectors.password);
                    
                    if (emailInput && passwordInput) {
                        console.error('Login form detected, filling credentials...');
                        
                        // Fill email
                        await emailInput.fill('${email}');
                        
                        // Fill password
                        await passwordInput.fill('${password}');
                        
                        // Find and click submit button
                        const submitButton = await page.$(loginSelectors.submit);
                        if (submitButton) {
                            console.error('Clicking submit button...');
                            // Use Promise.all to properly wait for navigation after form submit
                            await Promise.all([
                                page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
                                submitButton.click()
                            ]);
                            console.error('After login URL:', page.url());
                        } else {
                            console.error('No submit button found, trying Enter key');
                            await Promise.all([
                                page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
                                passwordInput.press('Enter')
                            ]);
                        }
                        
                        // Wait for page to stabilize
                        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                        
                        // Navigate to target page if we're not already there
                        if (!page.url().includes('${new URL(input.url).pathname}')) {
                            console.error('Navigating to target after login: ${input.url}');
                            await page.goto('${input.url}', { timeout: 30000, waitUntil: 'domcontentloaded' });
                            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                        }
                    } else {
                        console.error('No login form detected, page may be public or already authenticated');
                    }
                    
                    // Give page a moment to render
                    await new Promise(r => setTimeout(r, 2000));
                    
                    // Capture screenshot
                    const response = await page.evaluate(() => ({ url: window.location.href }));
                    const statusCode = 200; // We're on the page
                    const title = await page.title();
                    
                    await page.screenshot({ path: '${screenshotPath}', fullPage: false });
                    
                    // Get base64
                    const buffer = fs.readFileSync('${screenshotPath}');
                    const base64 = buffer.toString('base64');
                    
                    await browser.close();
                    console.log(JSON.stringify({ 
                        success: true, 
                        filePath: '${screenshotPath}', 
                        base64, 
                        title, 
                        statusCode, 
                        authenticated: true,
                        finalUrl: response.url 
                    }));
                } catch (err) {
                    console.log(JSON.stringify({ success: false, error: err.message }));
                }
            })();
        `;

        // Use base64 encoding and temp file to avoid shell escaping issues
        const scriptPath = `/tmp/auth-screenshot-${screenshotId}.js`;
        const base64Script = Buffer.from(captureScript).toString('base64');
        await execAsync(
            `docker exec ${PLAYWRIGHT_CONTAINER} sh -c 'echo "${base64Script}" | base64 -d > ${scriptPath}'`,
            { timeout: 10000 }
        );

        const { stdout } = await execAsync(
            `docker exec -e NODE_PATH=/tests/node_modules ${PLAYWRIGHT_CONTAINER} node ${scriptPath}`,
            { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
        );

        // Clean up script file
        await execAsync(`docker exec ${PLAYWRIGHT_CONTAINER} rm -f ${scriptPath}`, { timeout: 5000 }).catch(() => { });

        const result = JSON.parse(stdout.trim());
        const durationMs = Date.now() - startTime;
        logActivityComplete('tester', 'captureAuthenticatedScreenshot', durationMs, result.success);

        if (result.success) {
            logger.info({ title: result.title, finalUrl: result.finalUrl }, 'Authenticated screenshot captured');
        }

        return result;
    } catch (error: any) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('tester', 'captureAuthenticatedScreenshot', durationMs, false);

        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage, url: input.url }, 'Authenticated screenshot capture failed');

        // Fallback to unauthenticated
        logger.warn('Falling back to unauthenticated screenshot');
        return captureScreenshotAsBase64(input.url);
    }
}

