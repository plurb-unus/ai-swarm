import { NextRequest, NextResponse } from 'next/server';
import { passkeyService } from '@ai-swarm/shared';

/**
 * AI Swarm v3.0.0 - Passkey Authentication Verification API
 * 
 * POST /api/auth/passkey/login/verify
 * 
 * Verifies a passkey authentication response and returns user info
 * for NextAuth session creation.
 */

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { response, challengeId } = body;

        if (!response || !challengeId) {
            return NextResponse.json(
                { error: 'Missing response or challengeId' },
                { status: 400 }
            );
        }

        // Verify the passkey authentication
        const result = await passkeyService.verifyAuthentication(response, challengeId);

        if (!result.verified || !result.userId) {
            return NextResponse.json(
                { error: result.error || 'Authentication failed' },
                { status: 401 }
            );
        }

        // Return verified user ID for NextAuth signin
        return NextResponse.json({
            verified: true,
            userId: result.userId,
        });

    } catch (error) {
        console.error('Passkey authentication verification error:', error);
        return NextResponse.json(
            { error: 'Failed to verify authentication' },
            { status: 500 }
        );
    }
}
