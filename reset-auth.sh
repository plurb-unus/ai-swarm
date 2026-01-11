#!/usr/bin/env bash
#
# AI Swarm v3.0.0 - Auth Reset Tool
# Clears all passkeys and sessions for a user, then generates a new magic link.
#
# Usage:
#   ./reset-auth.sh [email]
#

set -e
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

EMAIL="${1:-admin@localhost}"

echo -e "${BLUE}AI Swarm v3.0.0 - Auth Reset${NC}"
echo ""
echo "This will:"
echo "  1. Clear all passkeys for: $EMAIL"
echo "  2. Invalidate any active verification tokens"
echo "  3. Generate a new magic link"
echo ""
echo -e "${YELLOW}Warning: You will need to re-register your passkeys after this.${NC}"
echo ""
read -p "Press Enter to continue or Ctrl+C to cancel..."

# Run reset inside portal container
docker exec -i ai-swarm-portal node -e "
const pg = require('pg');
const crypto = require('crypto');
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@postgres:5432/aiswarm',
});

async function reset() {
    const email = '$EMAIL'.toLowerCase().trim();
    
    // Find user
    const userResult = await pool.query('SELECT id FROM users WHERE email = \$1', [email]);
    if (userResult.rows.length === 0) {
        console.error('User not found:', email);
        process.exit(1);
    }
    const userId = userResult.rows[0].id;
    
    // Clear authenticators
    const authResult = await pool.query('DELETE FROM authenticators WHERE user_id = \$1', [userId]);
    console.log('Cleared', authResult.rowCount, 'passkey(s)');
    
    // Clear old tokens
    const tokenResult = await pool.query('DELETE FROM verification_tokens WHERE user_email = \$1', [email]);
    console.log('Cleared', tokenResult.rowCount, 'token(s)');
    
    // Generate new magic link
    const token = crypto.randomBytes(64).toString('base64url');
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    
    await pool.query(
        'INSERT INTO verification_tokens (token, user_email, expires, used) VALUES (\$1, \$2, \$3, false)',
        [token, email, expires]
    );
    
    const portalUrl = process.env.NEXTAUTH_URL || process.env.PORTAL_URL || 'http://localhost:3000';
    console.log('');
    console.log('New magic link:');
    console.log(portalUrl + '/api/auth/verify?token=' + token);
    console.log('');
    console.log('Expires:', expires.toISOString());
    
    await pool.end();
}

reset().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
"

echo ""
echo -e "${GREEN}Auth reset complete!${NC}"
echo "Use the magic link above to log in and register a new passkey."
