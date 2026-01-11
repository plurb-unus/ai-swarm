#!/usr/bin/env bash
#
# AI Swarm v3.0.0 - Teardown Script
# Removes all containers, volumes, and generated files
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_header() {
    echo ""
    echo -e "${RED}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║${NC}              ${BOLD}AI Swarm v3.0.0 Teardown${NC}                            ${RED}║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_warning() {
    echo -e "${YELLOW}This will:${NC}"
    echo ""
    echo -e "  • Stop all AI Swarm containers"
    echo -e "  • Remove all AI Swarm containers"
    echo -e "  • Remove all AI Swarm volumes (including data)"
    echo -e "  • Remove the generated .env file"
    echo ""
    echo -e "${RED}This action cannot be undone!${NC}"
    echo ""
}

confirm_teardown() {
    read -p "Are you sure you want to continue? [y/N]: " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo ""
        echo "Teardown cancelled."
        exit 0
    fi
}

teardown() {
    echo ""
    echo -e "${BOLD}Tearing down AI Swarm v3.0.0...${NC}"
    echo ""
    
    cd "$SCRIPT_DIR"
    
    # Stop and remove containers
    echo "  Stopping containers..."
    docker compose down --remove-orphans 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Containers stopped"
    
    # FIX: Handle up to 8 workers dynamically
    echo "  Removing volumes..."
    local base_volumes=("ai_swarm_postgres" "ai_swarm_redis" "ai_swarm_portal_home" "ai_swarm_project_data")
    for vol in "${base_volumes[@]}"; do
        docker volume rm "$vol" 2>/dev/null || true
    done
    # Remove worker volumes (1-8)
    for i in $(seq 1 8); do
        docker volume rm "ai_swarm_worker_${i}_home" 2>/dev/null || true
    done
    echo -e "  ${GREEN}✓${NC} Volumes removed"
    
    # Remove network
    echo "  Removing network..."
    docker network rm ai_swarm_network 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Network removed"
    
    # Remove .env file
    if [ -f "$SCRIPT_DIR/.env" ]; then
        echo "  Removing .env file..."
        rm -f "$SCRIPT_DIR/.env"
        echo -e "  ${GREEN}✓${NC} .env file removed"
    fi
    
    # Remove built files (optional)
    read -p "  Remove built files (node_modules, dist)? [y/N]: " remove_builds
    if [[ "$remove_builds" =~ ^[Yy]$ ]]; then
        echo "  Removing built files..."
        rm -rf "$SCRIPT_DIR/node_modules" 2>/dev/null || true
        rm -rf "$SCRIPT_DIR/packages/*/node_modules" 2>/dev/null || true
        rm -rf "$SCRIPT_DIR/packages/*/dist" 2>/dev/null || true
        rm -rf "$SCRIPT_DIR/apps/*/node_modules" 2>/dev/null || true
        rm -rf "$SCRIPT_DIR/apps/*/.next" 2>/dev/null || true
        echo -e "  ${GREEN}✓${NC} Built files removed"
    fi
    
    echo ""
    echo -e "${GREEN}Teardown complete!${NC}"
    echo ""
    echo "To redeploy, run:"
    echo -e "  ${CYAN}./deploy.sh${NC}"
    echo ""
}

main() {
    print_header
    print_warning
    confirm_teardown
    teardown
}

main "$@"
