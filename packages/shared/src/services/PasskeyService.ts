/**
 * AI Swarm v3.0.0 - Passkey Service
 * 
 * Handles WebAuthn passkey registration and authentication ceremonies.
 * Uses @simplewebauthn/server for cryptographic operations.
 */

import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
    VerifiedRegistrationResponse,
    VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoUint8Array } from '@simplewebauthn/server/helpers';
import type {
    PublicKeyCredentialCreationOptionsJSON,
    PublicKeyCredentialRequestOptionsJSON,
    RegistrationResponseJSON,
    AuthenticationResponseJSON,
} from '@simplewebauthn/types';
import { getPool } from '../db.js';
import { logger } from '../logger.js';
import { authChallengeService } from './AuthChallengeService.js';

export interface Authenticator {
    credential_id: string;
    user_id: string;
    credential_public_key: string;
    counter: number;
    credential_device_type: string;
    credential_backed_up: boolean;
    transports: string | null;
    name: string;
    created_at: Date;
    last_used_at: Date | null;
}

export interface PasskeyRegistrationResult {
    options: PublicKeyCredentialCreationOptionsJSON;
    challengeId: string;
}

export interface PasskeyAuthenticationResult {
    options: PublicKeyCredentialRequestOptionsJSON;
    challengeId: string;
}

export class PasskeyService {
    private rpName = 'AI Swarm';

    /**
     * Get Relying Party ID from environment
     */
    private getRpID(): string {
        const url = process.env.NEXTAUTH_URL || process.env.PORTAL_URL || 'http://localhost:3000';
        return new URL(url).hostname;
    }

    /**
     * Get origin from environment
     */
    private getOrigin(): string {
        return process.env.NEXTAUTH_URL || process.env.PORTAL_URL || 'http://localhost:3000';
    }

    /**
     * Get user's registered authenticators
     */
    async getUserAuthenticators(userId: string): Promise<Authenticator[]> {
        const pool = getPool();
        const result = await pool.query(
            `SELECT * FROM authenticators WHERE user_id = $1 ORDER BY created_at DESC`,
            [userId]
        );
        return result.rows;
    }

    /**
     * Step 1: Generate registration options for a new passkey
     */
    async generateRegistrationOptions(userId: string, userEmail: string): Promise<PasskeyRegistrationResult> {
        const userAuthenticators = await this.getUserAuthenticators(userId);
        const rpID = this.getRpID();

        const options = await generateRegistrationOptions({
            rpName: this.rpName,
            rpID,
            userID: isoUint8Array.fromUTF8String(userId),
            userName: userEmail,
            // Don't prompt for attestation (smoother UX)
            attestationType: 'none',
            // Prevent re-registering existing authenticators
            excludeCredentials: userAuthenticators.map(auth => ({
                id: auth.credential_id,
                transports: auth.transports ? (auth.transports.split(',') as AuthenticatorTransport[]) : undefined,
            })),
            authenticatorSelection: {
                // Require discoverable credentials (passkeys)
                residentKey: 'required',
                userVerification: 'preferred',
                // Prefer platform authenticators (TouchID, FaceID, Windows Hello)
                authenticatorAttachment: 'platform',
            },
        });

        // Store challenge for verification
        const challenge = await authChallengeService.createChallenge('registration', userId);

        logger.debug({ userId, rpID }, 'Generated passkey registration options');

        return {
            options: {
                ...options,
                challenge: challenge.challenge, // Use our stored challenge
            },
            challengeId: challenge.id,
        };
    }

    /**
     * Step 2: Verify registration response and save the passkey
     */
    async verifyRegistration(
        userId: string,
        response: RegistrationResponseJSON,
        challengeId: string,
        deviceName?: string
    ): Promise<{ verified: boolean; error?: string }> {
        const pool = getPool();
        const rpID = this.getRpID();
        const origin = this.getOrigin();

        // Consume the challenge (one-time use)
        const challenge = await authChallengeService.consumeChallenge(challengeId);
        if (!challenge) {
            return { verified: false, error: 'Challenge expired or invalid' };
        }

        try {
            const verification: VerifiedRegistrationResponse = await verifyRegistrationResponse({
                response,
                expectedChallenge: challenge.challenge,
                expectedOrigin: origin,
                expectedRPID: rpID,
            });

            if (!verification.verified || !verification.registrationInfo) {
                return { verified: false, error: 'Verification failed' };
            }

            const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

            // Save the new authenticator
            await pool.query(
                `INSERT INTO authenticators 
                (credential_id, user_id, credential_public_key, counter, credential_device_type, credential_backed_up, transports, name)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    credential.id,
                    userId,
                    Buffer.from(credential.publicKey).toString('base64'),
                    credential.counter,
                    credentialDeviceType,
                    credentialBackedUp,
                    response.response.transports ? response.response.transports.join(',') : null,
                    deviceName || 'My Device',
                ]
            );

            logger.info({ userId, credentialId: credential.id }, 'Passkey registered successfully');
            return { verified: true };

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ error: message }, 'Passkey registration verification failed');
            return { verified: false, error: message };
        }
    }

    /**
     * Step 3: Generate authentication options for passkey login
     */
    async generateAuthenticationOptions(userId?: string): Promise<PasskeyAuthenticationResult> {
        const rpID = this.getRpID();

        // If userId provided, only allow their registered passkeys
        let allowCredentials: { id: string; transports?: AuthenticatorTransport[] }[] | undefined;

        if (userId) {
            const userAuthenticators = await this.getUserAuthenticators(userId);
            allowCredentials = userAuthenticators.map(auth => ({
                id: auth.credential_id,
                transports: auth.transports ? (auth.transports.split(',') as AuthenticatorTransport[]) : undefined,
            }));
        }

        const options = await generateAuthenticationOptions({
            rpID,
            userVerification: 'preferred',
            allowCredentials,
        });

        // Store challenge for verification
        const challenge = await authChallengeService.createChallenge('authentication', userId);

        logger.debug({ userId, rpID }, 'Generated passkey authentication options');

        return {
            options: {
                ...options,
                challenge: challenge.challenge,
            },
            challengeId: challenge.id,
        };
    }

    /**
     * Step 4: Verify authentication response
     * Returns user ID if successful
     */
    async verifyAuthentication(
        response: AuthenticationResponseJSON,
        challengeId: string
    ): Promise<{ verified: boolean; userId?: string; error?: string }> {
        const pool = getPool();
        const rpID = this.getRpID();
        const origin = this.getOrigin();

        // Consume the challenge
        const challenge = await authChallengeService.consumeChallenge(challengeId);
        if (!challenge) {
            return { verified: false, error: 'Challenge expired or invalid' };
        }

        // Find the authenticator
        const authResult = await pool.query(
            `SELECT * FROM authenticators WHERE credential_id = $1`,
            [response.id]
        );

        if (authResult.rows.length === 0) {
            logger.warn({ credentialId: response.id }, 'Authenticator not found');
            return { verified: false, error: 'Authenticator not found' };
        }

        const authenticator: Authenticator = authResult.rows[0];

        try {
            const verification: VerifiedAuthenticationResponse = await verifyAuthenticationResponse({
                response,
                expectedChallenge: challenge.challenge,
                expectedOrigin: origin,
                expectedRPID: rpID,
                credential: {
                    id: authenticator.credential_id,
                    publicKey: Buffer.from(authenticator.credential_public_key, 'base64'),
                    counter: Number(authenticator.counter),
                    transports: authenticator.transports ?
                        (authenticator.transports.split(',') as AuthenticatorTransport[]) : undefined,
                },
            });

            if (!verification.verified) {
                return { verified: false, error: 'Verification failed' };
            }

            // SECURITY: Check for cloned authenticator (counter should always increase)
            const newCounter = verification.authenticationInfo.newCounter;
            if (newCounter <= Number(authenticator.counter) && Number(authenticator.counter) > 0) {
                logger.error(
                    { credentialId: authenticator.credential_id, oldCounter: authenticator.counter, newCounter },
                    'SECURITY: Possible cloned authenticator detected - counter decreased'
                );
                return { verified: false, error: 'Security error: authenticator counter mismatch' };
            }

            // Update counter and last used timestamp
            await pool.query(
                `UPDATE authenticators SET counter = $1, last_used_at = NOW() WHERE credential_id = $2`,
                [newCounter, authenticator.credential_id]
            );

            logger.info({ userId: authenticator.user_id, credentialId: authenticator.credential_id }, 'Passkey authentication successful');
            return { verified: true, userId: authenticator.user_id };

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ error: message }, 'Passkey authentication verification failed');
            return { verified: false, error: message };
        }
    }

    /**
     * Delete an authenticator
     */
    async deleteAuthenticator(userId: string, credentialId: string): Promise<boolean> {
        const pool = getPool();
        const result = await pool.query(
            `DELETE FROM authenticators WHERE user_id = $1 AND credential_id = $2`,
            [userId, credentialId]
        );
        const deleted = (result.rowCount || 0) > 0;
        if (deleted) {
            logger.info({ userId, credentialId }, 'Authenticator deleted');
        }
        return deleted;
    }

    /**
     * Rename an authenticator
     */
    async renameAuthenticator(userId: string, credentialId: string, name: string): Promise<boolean> {
        const pool = getPool();
        const result = await pool.query(
            `UPDATE authenticators SET name = $1 WHERE user_id = $2 AND credential_id = $3`,
            [name, userId, credentialId]
        );
        return (result.rowCount || 0) > 0;
    }

    /**
     * Clear all authenticators for a user (used by reset-auth.sh)
     */
    async clearUserAuthenticators(userId: string): Promise<number> {
        const pool = getPool();
        const result = await pool.query(
            `DELETE FROM authenticators WHERE user_id = $1`,
            [userId]
        );
        const deleted = result.rowCount || 0;
        logger.info({ userId, deleted }, 'Cleared user authenticators');
        return deleted;
    }
}

export const passkeyService = new PasskeyService();
