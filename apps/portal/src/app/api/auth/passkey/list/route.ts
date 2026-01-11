import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { passkeyService } from '@ai-swarm/shared';

/**
 * AI Swarm v3.0.0 - List User Passkeys API
 * 
 * GET /api/auth/passkey/list
 * 
 * Returns all passkeys registered for the current user.
 */

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = (session.user as any).id;
        if (!userId) {
            return NextResponse.json({ error: 'User ID not found' }, { status: 400 });
        }

        const authenticators = await passkeyService.getUserAuthenticators(userId);

        // Return sanitized list (no public keys)
        const sanitized = authenticators.map(auth => ({
            credential_id: auth.credential_id,
            name: auth.name,
            created_at: auth.created_at,
            last_used_at: auth.last_used_at,
            credential_device_type: auth.credential_device_type,
        }));

        return NextResponse.json({ authenticators: sanitized });

    } catch (error) {
        console.error('List passkeys error:', error);
        return NextResponse.json({ error: 'Failed to list passkeys' }, { status: 500 });
    }
}
