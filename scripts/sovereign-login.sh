#!/usr/bin/env bash
#
# AI Swarm v3.0.0 - Sovereign Login
# Generates a one-time magic link for portal authentication.
#
# Usage:
#   ./scripts/sovereign-login.sh [email]
#
# Examples:
#   ./scripts/sovereign-login.sh admin@example.com
#   ./scripts/sovereign-login.sh  # Uses admin@localhost
#

set -e

EMAIL="${1:-admin@localhost}"

# Check if we're running inside a container
if [ -f /.dockerenv ]; then
    # Inside container - run directly
    # Check if file exists in the bundled location
    if [ -f "/app/scripts/sovereign-login.mjs" ]; then
        node /app/scripts/sovereign-login.mjs "$EMAIL"
    else
        # Fallback to absolute path from workspace root
        node "$(dirname "$0")/sovereign-login.mjs" "$EMAIL"
    fi
else
    # Outside container - exec into portal
    CONTAINER_NAME=$(docker ps --format '{{.Names}}' | grep portal | head -1)
    if [ -z "$CONTAINER_NAME" ]; then
        echo "Error: AI Swarm Portal container not found."
        echo "Make sure the swarm is running: docker compose up -d"
        exit 1
    fi
    
    echo "Executing in container: $CONTAINER_NAME"
    docker exec -it "$CONTAINER_NAME" node /app/scripts/sovereign-login.mjs "$EMAIL"
fi
