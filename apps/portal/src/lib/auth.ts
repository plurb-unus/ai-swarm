import type { NextAuthOptions, User } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { passkeyService, magicLinkService } from '@ai-swarm/shared';

/**
 * AI Swarm v3.0.0 - Sovereign Authentication Configuration
 * 
 * AUTHENTICATION METHODS:
 * 1. Passkey (WebAuthn) - Primary method for daily login
 * 2. Magic Link (CLI-generated) - Bootstrap/recovery via SSH
 * 
 * Google OAuth has been removed for a fully self-contained auth system.
 * 
 * SESSION POLICY:
 * - 7 days sliding window (configurable via session_max_age_days)
 * - 30 days absolute maximum (configurable via session_absolute_max_days)
 * 
 * SECURITY:
 * - SameSite=Lax cookies
 * - WebAuthn counter validation to detect cloned authenticators
 * - Single-User Mode for bootstrap protection
 */

// Session max age in seconds (7 days default, configurable)
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

export const authOptions: NextAuthOptions = {
    providers: [
        CredentialsProvider({
            id: 'sovereign',
            name: 'Sovereign Auth',
            credentials: {
                type: { label: 'Type', type: 'text' },
                // For passkey auth
                credentialId: { label: 'Credential ID', type: 'text' },
                signature: { label: 'Signature', type: 'text' },
                authenticatorData: { label: 'Authenticator Data', type: 'text' },
                clientDataJSON: { label: 'Client Data JSON', type: 'text' },
                challengeId: { label: 'Challenge ID', type: 'text' },
                // For magic link auth
                token: { label: 'Token', type: 'text' },
            },
            async authorize(credentials): Promise<User | null> {
                if (!credentials) {
                    return null;
                }

                const { type } = credentials;

                // Magic Link Authentication
                if (type === 'magic-link') {
                    const token = credentials.token;
                    const userId = credentials.credentialId;

                    // If token is 'verified', the /api/auth/verify route already validated
                    // the magic link and we just need to look up the user by ID
                    if (token === 'verified' && userId) {
                        try {
                            const user = await magicLinkService.getUserById(userId);
                            if (!user) {
                                console.error('Magic link auth: User not found after verification');
                                return null;
                            }
                            return {
                                id: user.id,
                                email: user.email,
                                name: user.name || user.email.split('@')[0],
                            };
                        } catch (err) {
                            console.error('Magic link auth: Error looking up user:', err);
                            return null;
                        }
                    }

                    // Otherwise, verify the token directly (fallback path)
                    if (!token) {
                        console.error('Magic link auth: No token provided');
                        return null;
                    }

                    const user = await magicLinkService.verifyMagicLink(token);
                    if (!user) {
                        console.error('Magic link auth: Invalid or expired token');
                        return null;
                    }

                    return {
                        id: user.id,
                        email: user.email,
                        name: user.name || user.email.split('@')[0],
                    };
                }

                // Passkey Authentication
                if (type === 'passkey') {
                    const { challengeId } = credentials;

                    if (!challengeId) {
                        console.error('Passkey auth: No challenge ID provided');
                        return null;
                    }

                    // The full authentication response is passed as a JSON string
                    // This is handled by the passkey login API route which calls
                    // passkeyService.verifyAuthentication and then triggers signIn
                    // Here we just validate that we have a user ID from the verification
                    const userId = credentials.credentialId; // Actually contains userId after verification

                    if (!userId) {
                        console.error('Passkey auth: No user ID provided');
                        return null;
                    }

                    const user = await magicLinkService.getUserById(userId);
                    if (!user) {
                        console.error('Passkey auth: User not found');
                        return null;
                    }

                    return {
                        id: user.id,
                        email: user.email,
                        name: user.name || user.email.split('@')[0],
                    };
                }

                console.error('Unknown auth type:', type);
                return null;
            },
        }),
    ],

    callbacks: {
        async signIn({ user }) {
            // Allow all signins from our sovereign provider
            return !!user;
        },

        async jwt({ token, user }) {
            // Initial sign in - copy user data to token
            if (user) {
                token.id = user.id;
                token.email = user.email;
                token.name = user.name;
            }
            return token;
        },

        async session({ session, token }) {
            // Add user ID to session
            if (session.user && token.id) {
                (session.user as any).id = token.id;
            }
            return session;
        },
    },

    session: {
        strategy: 'jwt',
        maxAge: SESSION_MAX_AGE,
    },

    // Using NextAuth default cookie settings
    // This ensures withAuth middleware can find the session token

    pages: {
        signIn: '/auth/signin',
        error: '/auth/error',
    },

    secret: process.env.NEXTAUTH_SECRET,
};
