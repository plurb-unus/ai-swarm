#!/usr/bin/env node
/**
 * AI Swarm v3.0.0 - Sovereign Login CLI
 * 
 * Generates a one-time magic link for portal authentication.
 * Run from within a container that has database access.
 * 
 * Usage:
 *   node sovereign-login.mjs [email]
 *   
 * Examples:
 *   node sovereign-login.mjs admin@example.com
 *   ./scripts/sovereign-login.sh admin@example.com
 * 
 * Security:
 *   - Single-User Mode: Only creates user if no users exist
 *   - Token expires in 15 minutes
 *   - Token is single-use
 */

import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;

// Configuration
const TOKEN_TTL_MINUTES = 15;

// Get email from command line or default
const email = process.argv[2] || 'admin@localhost';
const normalizedEmail = email.toLowerCase().trim();

// Database connection - matches docker-compose.yml postgres service
const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'temporal',
    password: process.env.POSTGRES_PASSWORD || 'temporal',
    database: process.env.POSTGRES_DB || 'postgres',
});

async function main() {
    console.log('\n🔐 AI Swarm Sovereign Login\n');

    try {
        // Check auth mode
        const modeResult = await pool.query(
            "SELECT value FROM system_config WHERE key = 'auth_mode'"
        );
        const authMode = modeResult.rows[0]?.value || 'single_user';

        // Count existing users
        const countResult = await pool.query('SELECT COUNT(*) FROM users');
        const userCount = parseInt(countResult.rows[0].count, 10);

        // Check if user exists
        const userResult = await pool.query(
            'SELECT id, email FROM users WHERE email = $1',
            [normalizedEmail]
        );

        let userId;
        let created = false;

        if (userResult.rows.length === 0) {
            // User doesn't exist
            if (authMode === 'single_user' && userCount > 0) {
                console.error('❌ Error: Single-User Mode is enabled.');
                console.error('   Cannot create additional users.');
                console.error('   Use an existing admin email or set auth_mode to "multi_user".');
                console.error('\n   To change mode, run:');
                console.error("   UPDATE system_config SET value = 'multi_user' WHERE key = 'auth_mode';");
                process.exit(1);
            }

            // Create user
            const insertResult = await pool.query(
                'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id',
                [normalizedEmail, normalizedEmail.split('@')[0]]
            );
            userId = insertResult.rows[0].id;
            created = true;
            console.log(`✅ Created new user: ${normalizedEmail}`);
        } else {
            userId = userResult.rows[0].id;
            console.log(`📧 User found: ${normalizedEmail}`);
        }

        // Generate cryptographically secure token
        const token = crypto.randomBytes(64).toString('base64url');
        const expires = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

        // Insert token
        await pool.query(
            'INSERT INTO verification_tokens (token, user_email, expires, used) VALUES ($1, $2, $3, false)',
            [token, normalizedEmail, expires]
        );

        // Build URL
        const portalUrl = process.env.NEXTAUTH_URL || process.env.PORTAL_URL || 'http://localhost:3000';
        const url = `${portalUrl}/api/auth/verify?token=${token}`;

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔗 Magic Link (valid for 15 minutes):');
        console.log('');
        console.log(`   ${url}`);
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\n📋 Click the link above or copy-paste into your browser.');
        console.log(`   Expires: ${expires.toISOString()}\n`);

        if (created) {
            console.log('💡 Tip: After logging in, go to Settings > Security to register a passkey');
            console.log('   for faster, more secure logins in the future.\n');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
