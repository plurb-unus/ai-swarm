import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { passkeyService } from '@ai-swarm/shared';

/**
 * AI Swarm v3.0.0 - Passkey Registration Verification API
 * 
 * POST /api/auth/passkey/register/verify
 * 
 * Verifies and saves a new passkey after WebAuthn registration ceremony.
 * Requires authenticated session.
 */

export async function POST(request: NextRequest) {
    try {
        // Require authenticated session
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = (session.user as any).id;
        if (!userId) {
            return NextResponse.json({ error: 'User ID not found in session' }, { status: 400 });
        }

        const body = await request.json();
        const { response, challengeId, deviceName } = body;

        if (!response || !challengeId) {
            return NextResponse.json(
                { error: 'Missing response or challengeId' },
                { status: 400 }
            );
        }

        // Verify and save the passkey
        const result = await passkeyService.verifyRegistration(
            userId,
            response,
            challengeId,
            deviceName
        );

        if (!result.verified) {
            return NextResponse.json(
                { error: result.error || 'Verification failed' },
                { status: 400 }
            );
        }

        return NextResponse.json({ verified: true });

    } catch (error) {
        console.error('Passkey registration verification error:', error);
        return NextResponse.json(
            { error: 'Failed to verify registration' },
            { status: 500 }
        );
    }
}
