/**
 * AI Swarm v3.0.0 - Auth Challenge Service
 * 
 * Manages WebAuthn challenge storage for replay attack prevention.
 * Challenges are one-time use with 5-minute expiry.
 */

import { getPool } from '../db.js';
import { logger } from '../logger.js';
import crypto from 'crypto';

export type ChallengeType = 'registration' | 'authentication';

export interface AuthChallenge {
    id: string;
    challenge: string;
    user_id: string | null;
    type: ChallengeType;
    expires: Date;
}

export class AuthChallengeService {
    private readonly CHALLENGE_TTL_MINUTES = 5;

    /**
     * Create a new challenge for WebAuthn ceremony
     */
    async createChallenge(type: ChallengeType, userId?: string): Promise<AuthChallenge> {
        const pool = getPool();
        const challenge = crypto.randomBytes(32).toString('base64url');
        const expires = new Date(Date.now() + this.CHALLENGE_TTL_MINUTES * 60 * 1000);

        const result = await pool.query(
            `INSERT INTO auth_challenges (challenge, user_id, type, expires)
             VALUES ($1, $2, $3, $4)
             RETURNING id, challenge, user_id, type, expires`,
            [challenge, userId || null, type, expires]
        );

        logger.debug({ type, userId }, 'Auth challenge created');
        return result.rows[0];
    }

    /**
     * Consume a challenge (one-time use)
     * Returns the challenge if valid, null if expired/not found
     */
    async consumeChallenge(challengeId: string): Promise<AuthChallenge | null> {
        const pool = getPool();

        // Delete and return in one atomic operation
        const result = await pool.query(
            `DELETE FROM auth_challenges 
             WHERE id = $1 AND expires > NOW()
             RETURNING id, challenge, user_id, type, expires`,
            [challengeId]
        );

        if (result.rows.length === 0) {
            logger.warn({ challengeId }, 'Challenge not found or expired');
            return null;
        }

        logger.debug({ challengeId }, 'Auth challenge consumed');
        return result.rows[0];
    }

    /**
     * Clean up expired challenges (maintenance task)
     */
    async cleanupExpired(): Promise<number> {
        const pool = getPool();
        const result = await pool.query(
            `DELETE FROM auth_challenges WHERE expires < NOW()`
        );
        const deleted = result.rowCount || 0;
        if (deleted > 0) {
            logger.info({ deleted }, 'Cleaned up expired auth challenges');
        }
        return deleted;
    }
}

export const authChallengeService = new AuthChallengeService();
