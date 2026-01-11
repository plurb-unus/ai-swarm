#!/usr/bin/env bash
#
# AI Swarm v3.0.0 - Claude Pro/Max Authentication
# Authenticates Claude Code CLI - only ONE worker needed (credentials shared via symlinks)
#

set -e

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
BOLD='\033[1m'

# Load env
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

echo ""
echo -e "${BLUE}====================================================================${NC}"
echo -e "${BLUE}||${NC}     ${BOLD}AI Swarm v3.0.0 - Claude Pro/Max Authentication${NC}           ${BLUE}||${NC}"
echo -e "${BLUE}====================================================================${NC}"
echo ""
echo -e "${GREEN}Credentials are SHARED across all workers via symlinks.${NC}"
echo -e "${GREEN}You only need to authenticate ONCE on any worker.${NC}"
echo ""
echo -e "${BOLD}Step 1: Access any worker container${NC}"
echo -e "  ${GREEN}docker exec -it ai-swarm-worker-1 bash${NC}"
echo ""
echo -e "${BOLD}Step 2: Run Claude login (opens browser)${NC}"
echo -e "  ${GREEN}claude${NC}"
echo -e "  Then type: ${YELLOW}/login${NC}"
echo ""
echo -e "${BOLD}Step 3: Follow the browser prompts to authenticate${NC}"
echo ""
echo -e "${YELLOW}Note: You must have an active Claude Pro or Max subscription.${NC}"
echo -e "${YELLOW}All workers will automatically have access after authenticating once.${NC}"
echo ""
echo -e "${BLUE}--------------------------------------------------------------------${NC}"
echo ""
echo -e "Check verification status at: ${BOLD}https://${PORTAL_DOMAIN:-localhost:3000}/settings/llm${NC}"
echo ""
