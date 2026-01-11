import { NextRequest, NextResponse } from 'next/server';
import { magicLinkService } from '@ai-swarm/shared';

/**
 * AI Swarm v3.0.0 - Magic Link Verification API
 * 
 * GET /api/auth/verify?token=xxx
 * 
 * Verifies a CLI-generated magic link token and redirects to dashboard.
 * This endpoint is called when user clicks the magic link URL.
 */

// Get the public URL for redirects
function getPublicUrl(): string {
    return process.env.NEXTAUTH_URL || process.env.PORTAL_URL || 'http://localhost:3000';
}

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');
    const publicUrl = getPublicUrl();

    if (!token) {
        return NextResponse.redirect(new URL('/auth/error?error=MissingToken', publicUrl));
    }

    try {
        // Verify the magic link token
        const user = await magicLinkService.verifyMagicLink(token);

        if (!user) {
            return NextResponse.redirect(new URL('/auth/error?error=InvalidToken', publicUrl));
        }

        // Create a signed URL that will trigger NextAuth login
        // We pass the verified user info to the signin page which will
        // automatically call signIn('sovereign', { type: 'magic-link', ... })
        const callbackUrl = new URL('/auth/callback', publicUrl);
        callbackUrl.searchParams.set('userId', user.id);
        callbackUrl.searchParams.set('email', user.email);
        callbackUrl.searchParams.set('name', user.name || '');

        return NextResponse.redirect(callbackUrl);

    } catch (error) {
        console.error('Magic link verification error:', error);
        return NextResponse.redirect(new URL('/auth/error?error=VerificationFailed', publicUrl));
    }
}
