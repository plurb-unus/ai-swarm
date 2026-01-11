import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { passkeyService } from '@ai-swarm/shared';

/**
 * AI Swarm v3.0.0 - Passkey Registration Options API
 * 
 * POST /api/auth/passkey/register/options
 * 
 * Generates WebAuthn registration options for adding a new passkey.
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
        const userEmail = session.user.email;

        if (!userId) {
            return NextResponse.json({ error: 'User ID not found in session' }, { status: 400 });
        }

        // Generate registration options
        const result = await passkeyService.generateRegistrationOptions(userId, userEmail);

        return NextResponse.json({
            options: result.options,
            challengeId: result.challengeId,
        });

    } catch (error) {
        console.error('Passkey registration options error:', error);
        return NextResponse.json(
            { error: 'Failed to generate registration options' },
            { status: 500 }
        );
    }
}
