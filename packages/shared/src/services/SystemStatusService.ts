/**
 * AI Swarm v3.0.0 - System Status Service
 * 
 * Handles real-time status checks (CLI auth, etc.)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { access, constants } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../logger.js';

const execAsync = promisify(exec);

export class SystemStatusService {
    /**
     * Check authentication status for Claude Code and Gemini CLI
     * This runs commands locally on the instance where it is called.
     */
    async checkAuthStatus() {
        const results = {
            claude: { authenticated: false, message: '' },
            gemini: { authenticated: false, message: '' }
        };

        // Check Claude using `claude doctor`
        // Reference: CLAUDE_CLI.md - "claude doctor: Check health of auto-updater/installation"
        try {
            const { stdout, stderr } = await execAsync('claude doctor 2>&1', { timeout: 10000 });
            const output = stdout + stderr;

            // claude doctor outputs health check info - look for authentication indicators
            if (output.includes('Authenticated') ||
                output.includes('logged in') ||
                output.includes('Pro') ||
                output.includes('Max') ||
                !output.includes('not authenticated') && !output.includes('Please log in')) {
                results.claude.authenticated = true;
                results.claude.message = 'Authenticated';
            } else {
                results.claude.message = 'Requires Login';
            }
        } catch (err: any) {
            // Fallback: check for OAuth credentials file
            try {
                const oauthPath = join(homedir(), '.claude', 'oauth.json');
                await access(oauthPath, constants.R_OK);
                results.claude.authenticated = true;
                results.claude.message = 'Credentials found';
            } catch {
                results.claude.message = 'Requires Login';
            }
        }

        // Check Gemini - no direct auth check command
        // Reference: GEMINI_CLI.md - settings stored in ~/.gemini/settings.json
        // Check for credentials/config files
        try {
            const geminiDir = join(homedir(), '.gemini');

            // Check for common credential locations
            const credentialPaths = [
                join(geminiDir, 'credentials.json'),
                join(geminiDir, 'settings.json'),
                join(geminiDir, 'oauth_credentials.json'),
            ];

            let foundCredentials = false;
            for (const credPath of credentialPaths) {
                try {
                    await access(credPath, constants.R_OK);
                    foundCredentials = true;
                    break;
                } catch {
                    // Continue checking other paths
                }
            }

            if (foundCredentials) {
                // Credentials exist, try a simple version check to confirm CLI works
                try {
                    await execAsync('gemini --version', { timeout: 5000 });
                    results.gemini.authenticated = true;
                    results.gemini.message = 'Authenticated';
                } catch {
                    // CLI not working but credentials exist
                    results.gemini.authenticated = true;
                    results.gemini.message = 'Credentials found (CLI unavailable)';
                }
            } else {
                // No credentials found, check if CLI exists
                try {
                    await execAsync('gemini --version', { timeout: 5000 });
                    results.gemini.message = 'Requires Login';
                } catch {
                    results.gemini.message = 'Requires Login';
                }
            }
        } catch (err: any) {
            logger.debug({ err }, 'Gemini auth check failed');
            results.gemini.message = 'Requires Login';
        }

        return results;
    }
}

export const systemStatusService = new SystemStatusService();
