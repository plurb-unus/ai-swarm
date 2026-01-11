import { NextRequest, NextResponse } from 'next/server';
import { passkeyService } from '@ai-swarm/shared';

/**
 * AI Swarm v3.0.0 - Passkey Authentication Options API
 * 
 * GET /api/auth/passkey/login/options
 * 
 * Generates WebAuthn authentication options for passkey login.
 * No authentication required (this is the login flow).
 */

export async function GET(request: NextRequest) {
    try {
        // Generate authentication options (no user ID - discoverable credentials)
        const result = await passkeyService.generateAuthenticationOptions();

        return NextResponse.json({
            options: result.options,
            challengeId: result.challengeId,
        });

    } catch (error) {
        console.error('Passkey authentication options error:', error);
        return NextResponse.json(
            { error: 'Failed to generate authentication options' },
            { status: 500 }
        );
    }
}
