import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { passkeyService } from '@ai-swarm/shared';

/**
 * AI Swarm v3.0.0 - Delete Passkey API
 * 
 * POST /api/auth/passkey/delete
 * 
 * Deletes a passkey from the current user's account.
 */

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = (session.user as any).id;
        if (!userId) {
            return NextResponse.json({ error: 'User ID not found' }, { status: 400 });
        }

        const body = await request.json();
        const { credentialId } = body;

        if (!credentialId) {
            return NextResponse.json({ error: 'Missing credentialId' }, { status: 400 });
        }

        const deleted = await passkeyService.deleteAuthenticator(userId, credentialId);

        if (!deleted) {
            return NextResponse.json({ error: 'Passkey not found' }, { status: 404 });
        }

        return NextResponse.json({ deleted: true });

    } catch (error) {
        console.error('Delete passkey error:', error);
        return NextResponse.json({ error: 'Failed to delete passkey' }, { status: 500 });
    }
}
