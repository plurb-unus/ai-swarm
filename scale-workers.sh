#!/usr/bin/env bash
#
# AI Swarm v3.0.0 - Scale Workers
# Adjusts the number of worker containers (1-8)
#
# Usage:
#   ./scale-workers.sh [count]
#
# Examples:
#   ./scale-workers.sh 8    # Scale to 8 workers
#   ./scale-workers.sh 2    # Scale down to 2 workers
#   ./scale-workers.sh      # Prompts for count
#

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Get count from argument or prompt
if [ -n "$1" ]; then
    COUNT="$1"
else
    echo ""
    echo -e "${BOLD}AI Swarm - Scale Workers${NC}"
    echo ""
    echo "Current configuration:"
    
    # Load current value
    if [ -f .env ]; then
        source .env 2>/dev/null || true
        echo -e "  .env WORKER_COUNT: ${CYAN}${WORKER_COUNT:-4}${NC}"
    fi
    
    # Show running workers
    running_workers=$(docker ps --filter "name=ai-swarm-worker" --format "{{.Names}}" 2>/dev/null | wc -l | tr -d ' ')
    echo -e "  Running workers:   ${CYAN}${running_workers}${NC}"
    echo ""
    
    read -p "New worker count (1-8): " COUNT
fi

# Validate input
if ! [[ "$COUNT" =~ ^[1-8]$ ]]; then
    echo -e "${RED}Error: Worker count must be between 1 and 8.${NC}"
    echo "Usage: ./scale-workers.sh [1-8]"
    exit 1
fi

echo ""
echo -e "${BOLD}Scaling to ${COUNT} workers...${NC}"
echo ""

# Step 1: Update .env
echo -e "  [1/3] Updating .env..."
if grep -q "^WORKER_COUNT=" .env 2>/dev/null; then
    # macOS and Linux compatible sed
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/^WORKER_COUNT=.*/WORKER_COUNT=$COUNT/" .env
    else
        sed -i "s/^WORKER_COUNT=.*/WORKER_COUNT=$COUNT/" .env
    fi
else
    echo "WORKER_COUNT=$COUNT" >> .env
fi
echo -e "  ${GREEN}✓ .env updated${NC}"

# Step 2: Update database
echo -e "  [2/3] Updating database..."
docker exec ai-swarm-portal node -e "
const pg = require('pg');
const pool = new pg.Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: process.env.POSTGRES_PORT || 5432,
    user: process.env.POSTGRES_USER || 'temporal',
    password: process.env.POSTGRES_PASSWORD || 'temporal',
    database: process.env.POSTGRES_DB || 'postgres'
});
pool.query(
    \"INSERT INTO system_config (key, value, updated_at) VALUES ('worker_count', '\$COUNT', NOW()) ON CONFLICT (key) DO UPDATE SET value = '\$COUNT', updated_at = NOW()\".replace(/\\\$COUNT/g, '$COUNT')
).then(() => {
    console.log('  ✓ Database updated');
    pool.end();
}).catch(err => {
    console.error('  Error updating database:', err.message);
    pool.end();
    process.exit(1);
});
"

# Step 3: Restart containers
echo -e "  [3/3] Restarting containers..."
docker compose up -d
echo -e "  ${GREEN}✓ Containers restarted${NC}"

echo ""
echo -e "${GREEN}${BOLD}Worker count scaled to ${COUNT}${NC}"
echo ""

# Verify
sleep 3
running_workers=$(docker ps --filter "name=ai-swarm-worker" --format "{{.Names}}" 2>/dev/null | wc -l | tr -d ' ')
echo -e "Running workers: ${CYAN}${running_workers}${NC}"
echo ""
