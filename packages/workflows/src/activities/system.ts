/**
 * AI Swarm v3.0.0 - System Activities
 * 
 * Backend activities for system - wide operations like auth status verification.
 */

import { systemStatusService, logger } from '@ai-swarm/shared';

/**
 * Check authentication status for Claude Code and Gemini CLI
 */
export async function checkAuthStatus() {
    return systemStatusService.checkAuthStatus();
}
