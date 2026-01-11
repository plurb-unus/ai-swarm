import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';

/**
 * AI Swarm v3.0.0 - NextAuth Route Handler
 * 
 * OAuth credentials are loaded by the container entrypoint from database
 * into environment variables before Next.js starts.
 */

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
