/**
 * AI Swarm v3.0.0 - Magic Link Service
 * 
 * Handles CLI-generated one-time login tokens.
 * Tokens are 64 bytes, 15-minute expiry, single-use.
 */

import { getPool } from '../db.js';
import { logger } from '../logger.js';
import crypto from 'crypto';
import { systemConfigService } from './SystemConfigService.js';

export interface VerificationToken {
    token: string;
    user_email: string;
    expires: Date;
    used: boolean;
}

export interface User {
    id: string;
    email: string;
    name: string | null;
    created_at: Date;
}

export class MagicLinkService {
    private readonly TOKEN_TTL_MINUTES = 15;

    /**
     * Generate a magic link token for a user email
     * Creates user if not exists (respects Single-User Mode)
     */
    async generateMagicLink(userEmail: string): Promise<{ token: string; url: string; created: boolean }> {
        const pool = getPool();
        const normalizedEmail = userEmail.toLowerCase().trim();

        // Check Single-User Mode
        const authMode = await systemConfigService.getConfig('auth_mode') || 'single_user';
        const existingUsers = await pool.query('SELECT COUNT(*) FROM users');
        const userCount = parseInt(existingUsers.rows[0].count, 10);

        // Check if user exists
        let userResult = await pool.query(
            'SELECT id, email FROM users WHERE email = $1',
            [normalizedEmail]
        );

        let created = false;

        if (userResult.rows.length === 0) {
            // User doesn't exist - check if we can create
            if (authMode === 'single_user' && userCount > 0) {
                throw new Error('Single-User Mode: Cannot create additional users. Use an existing admin email or set auth_mode to multi_user.');
            }

            // Create user
            userResult = await pool.query(
                `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, email`,
                [normalizedEmail, normalizedEmail.split('@')[0]]
            );
            created = true;
            logger.info({ email: normalizedEmail }, 'Created new user via magic link');
        }

        // Generate cryptographically secure token
        const token = crypto.randomBytes(64).toString('base64url');
        const expires = new Date(Date.now() + this.TOKEN_TTL_MINUTES * 60 * 1000);

        // Insert token
        await pool.query(
            `INSERT INTO verification_tokens (token, user_email, expires, used)
             VALUES ($1, $2, $3, false)`,
            [token, normalizedEmail, expires]
        );

        // Build URL
        const portalUrl = process.env.NEXTAUTH_URL || process.env.PORTAL_URL || 'http://localhost:3000';
        const url = `${portalUrl}/api/auth/verify?token=${token}`;

        logger.info({ email: normalizedEmail, expires }, 'Magic link generated');

        return { token, url, created };
    }

    /**
     * Verify and consume a magic link token
     * Returns the user email if valid, null otherwise
     */
    async verifyMagicLink(token: string): Promise<User | null> {
        const pool = getPool();

        // Atomically mark as used and return
        const result = await pool.query(
            `UPDATE verification_tokens 
             SET used = true
             WHERE token = $1 AND expires > NOW() AND used = false
             RETURNING user_email`,
            [token]
        );

        if (result.rows.length === 0) {
            logger.warn('Invalid, expired, or already-used magic link');
            return null;
        }

        const userEmail = result.rows[0].user_email;

        // Get user
        const userResult = await pool.query(
            'SELECT id, email, name, created_at FROM users WHERE email = $1',
            [userEmail]
        );

        if (userResult.rows.length === 0) {
            logger.error({ email: userEmail }, 'User not found after magic link verification');
            return null;
        }

        logger.info({ email: userEmail }, 'Magic link verified successfully');
        return userResult.rows[0];
    }

    /**
     * Check if a user exists
     */
    async userExists(email: string): Promise<boolean> {
        const pool = getPool();
        const result = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [email.toLowerCase().trim()]
        );
        return result.rows.length > 0;
    }

    /**
     * Get user by email
     */
    async getUserByEmail(email: string): Promise<User | null> {
        const pool = getPool();
        const result = await pool.query(
            'SELECT id, email, name, created_at FROM users WHERE email = $1',
            [email.toLowerCase().trim()]
        );
        return result.rows[0] || null;
    }

    /**
     * Get user by ID
     */
    async getUserById(userId: string): Promise<User | null> {
        const pool = getPool();
        const result = await pool.query(
            'SELECT id, email, name, created_at FROM users WHERE id = $1',
            [userId]
        );
        return result.rows[0] || null;
    }

    /**
     * Get total count of users
     */
    async getUsersCount(): Promise<number> {
        const pool = getPool();
        const result = await pool.query('SELECT COUNT(*) FROM users');
        return parseInt(result.rows[0].count, 10);
    }

    /**
     * Create the first admin user
     */
    async createFirstUser(email: string): Promise<User> {
        const count = await this.getUsersCount();
        if (count > 0) {
            throw new Error('Initial admin already exists');
        }

        const pool = getPool();
        const normalizedEmail = email.toLowerCase().trim();
        const result = await pool.query(
            `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, email, name, created_at`,
            [normalizedEmail, normalizedEmail.split('@')[0]]
        );

        logger.info({ email: normalizedEmail }, 'Created initial admin user');
        return result.rows[0];
    }

    /**
     * Clean up expired tokens (maintenance task)
     */
    async cleanupExpired(): Promise<number> {
        const pool = getPool();
        const result = await pool.query(
            `DELETE FROM verification_tokens WHERE expires < NOW()`
        );
        const deleted = result.rowCount || 0;
        if (deleted > 0) {
            logger.info({ deleted }, 'Cleaned up expired verification tokens');
        }
        return deleted;
    }
}

export const magicLinkService = new MagicLinkService();
