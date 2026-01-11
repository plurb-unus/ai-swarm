#!/usr/bin/env bash
#
# AI Swarm v3.0.0 - Deployment Script
# Interactive deployment with pre-flight checks
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
REQUIRED_NODE_VERSION=20
REQUIRED_PNPM_VERSION=8
MIN_DISK_SPACE_GB=5

# Default ports
DEFAULT_PORTAL_PORT=3000
DEFAULT_TEMPORAL_PORT=7233
DEFAULT_TEMPORAL_UI_PORT=8233
DEFAULT_REDIS_PORT=6379
DEFAULT_PROMETHEUS_PORT=9090
DEFAULT_GRAFANA_PORT=3001

#==============================================================================
# UTILITY FUNCTIONS
#==============================================================================

print_header() {
    echo ""
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}             ${BOLD}AI Swarm v3.0.0 Deployment${NC}                         ${BLUE}║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_section() {
    echo ""
    echo -e "${CYAN}─────────────────────────────────────────────────────────────────${NC}"
    echo -e "${BOLD}$1${NC}"
    echo -e "${CYAN}─────────────────────────────────────────────────────────────────${NC}"
}

check_ok() {
    echo -e "  ${GREEN}✓${NC} $1"
}

check_fail() {
    echo -e "  ${RED}✗${NC} $1"
}

check_warn() {
    echo -e "  ${YELLOW}⚠${NC} $1"
}

prompt_input() {
    local prompt="$1"
    local default="$2"
    local var_name="$3"
    
    if [ -n "$default" ]; then
        read -p "  $prompt [$default]: " value
        value="${value:-$default}"
    else
        read -p "  $prompt: " value
    fi
    
    # FIX: Replaced eval with a safer indirect variable assignment
    if [[ "$var_name" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
        printf -v "$var_name" "%s" "$value"
    else
        echo -e "${RED}Invalid variable name: $var_name${NC}"
        exit 1
    fi
}

prompt_secret() {
    local prompt="$1"
    local var_name="$2"
    
    read -s -p "  $prompt: " value
    echo ""
    echo ""
    # FIX: Replaced eval with a safer indirect variable assignment
    if [[ "$var_name" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
        printf -v "$var_name" "%s" "$value"
    else
        echo -e "${RED}Invalid variable name: $var_name${NC}"
        exit 1
    fi
}

#==============================================================================
# PRE-FLIGHT CHECKS
#==============================================================================

preflight_checks() {
    print_section "🔍 ENVIRONMENT CHECK"
    
    local all_passed=true
    
    # Check Docker
    if command -v docker &> /dev/null; then
        local docker_version=$(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
        check_ok "Docker: v$docker_version"
    else
        check_fail "Docker: NOT INSTALLED"
        echo -e "     ${YELLOW}Install from: https://docs.docker.com/get-docker/${NC}"
        all_passed=false
    fi
    
    # Check Docker Compose
    if docker compose version &> /dev/null; then
        local compose_version=$(docker compose version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
        check_ok "Docker Compose: v$compose_version"
    else
        check_fail "Docker Compose: NOT INSTALLED"
        all_passed=false
    fi
    
    # Check Docker daemon is running
    if docker info &> /dev/null; then
        check_ok "Docker daemon: running"
    else
        check_fail "Docker daemon: NOT RUNNING"
        echo -e "     ${YELLOW}Start Docker Desktop or run: sudo systemctl start docker${NC}"
        all_passed=false
    fi
    
    # Node.js and pnpm checks removed - building in Docker

    
    # Check git
    if command -v git &> /dev/null; then
        check_ok "git: $(git --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
    else
        check_fail "git: NOT INSTALLED"
        all_passed=false
    fi
    
    # Check GitHub CLI
    if command -v gh &> /dev/null; then
        check_ok "GitHub CLI: $(gh --version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
    else
        check_warn "GitHub CLI: NOT INSTALLED (optional, for PR creation)"
        echo -e "     ${YELLOW}Install from: https://cli.github.com/${NC}"
    fi
    
    # Check disk space
    local available_gb=$(df -BG "$SCRIPT_DIR" | tail -1 | awk '{print $4}' | tr -d 'G')
    if [ "$available_gb" -ge "$MIN_DISK_SPACE_GB" ]; then
        check_ok "Disk space: ${available_gb}GB available"
    else
        check_fail "Disk space: ${available_gb}GB available (requires ${MIN_DISK_SPACE_GB}GB+)"
        all_passed=false
    fi
    
    # Check if existing containers are running
    local existing_containers=$(docker ps -a --filter "name=ai-swarm" --format "{{.Names}}" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$existing_containers" -gt 0 ]; then
        check_warn "Existing AI Swarm containers detected: $existing_containers"
        echo ""
        echo -e "  ${YELLOW}Found existing containers:${NC}"
        docker ps -a --filter "name=ai-swarm" --format "    - {{.Names}} ({{.Status}})"
        echo ""
        echo -e "  ${YELLOW}To tear down existing deployment:${NC}"
        echo -e "    ${CYAN}./teardown.sh${NC}"
        echo ""
        read -p "  Continue anyway? [y/N]: " continue_anyway
        if [[ ! "$continue_anyway" =~ ^[Yy]$ ]]; then
            echo ""
            echo -e "${YELLOW}Deployment cancelled. Run ./teardown.sh first.${NC}"
            exit 0
        fi
    fi
    
    if [ "$all_passed" = false ]; then
        echo ""
        echo -e "${RED}Pre-flight checks failed. Please fix the issues above and try again.${NC}"
        exit 1
    fi
    
    echo ""
    echo -e "${GREEN}All pre-flight checks passed!${NC}"
}

#==============================================================================
# PORT CHECK
#==============================================================================

check_port() {
    local port=$1
    local name=$2
    
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 1  # Port in use
    else
        return 0  # Port available
    fi
}

check_ports() {
    print_section "🔌 PORT AVAILABILITY"
    
    local ports_ok=true
    
    # Check each port and offer alternatives if in use
    for port_info in "PORTAL_PORT:$DEFAULT_PORTAL_PORT:Portal" \
                     "TEMPORAL_PORT:$DEFAULT_TEMPORAL_PORT:Temporal gRPC" \
                     "TEMPORAL_UI_PORT:$DEFAULT_TEMPORAL_UI_PORT:Temporal UI" \
                     "REDIS_PORT:$DEFAULT_REDIS_PORT:Redis" \
                     "PROMETHEUS_PORT:$DEFAULT_PROMETHEUS_PORT:Prometheus" \
                     "GRAFANA_PORT:$DEFAULT_GRAFANA_PORT:Grafana"; do
        
        IFS=':' read -r var_name default_port service_name <<< "$port_info"
        
        if check_port $default_port; then
            check_ok "$service_name: port $default_port available"
            # FIX: Use printf -v for safer indirect assignment
            printf -v "$var_name" "%s" "$default_port"
        else
            check_warn "$service_name: port $default_port IN USE"
            local new_port=$((default_port + 10))
            while ! check_port $new_port && [ $new_port -lt $((default_port + 100)) ]; do
                new_port=$((new_port + 1))
            done
            read -p "    Use alternative port [$new_port]: " user_port
            user_port="${user_port:-$new_port}"
            # FIX: Use printf -v for safer indirect assignment
            printf -v "$var_name" "%s" "$user_port"
            check_ok "$service_name: using port $user_port"
        fi
    done
}

#==============================================================================
# CONFIGURATION
#==============================================================================

collect_configuration() {
    print_section "📝 CONFIGURATION"
    
    echo ""
    echo "  Required settings:"
    echo ""
    
    # Traefik Configuration
    print_section "🌐 TRAEFIK & DOMAIN SETUP"

    echo ""
    echo "  This deployment assumes you have a Traefik instance running"
    echo "  on a shared Docker network (e.g., 'traefik-public')."
    echo ""

    prompt_input "Traefik External Network" "traefik-public" TRAEFIK_NETWORK
    
    # Check if network exists
    if ! docker network inspect "$TRAEFIK_NETWORK" >/dev/null 2>&1; then
        echo -e "  ${YELLOW}Warning: Network '$TRAEFIK_NETWORK' does not exist.${NC}"
        read -p "  Has Traefik been deployed yet? [y/N]: " traefik_ready
        if [[ ! "$traefik_ready" =~ ^[Yy]$ ]]; then
             echo -e "  ${RED}Please deploy Traefik first or create the network.${NC}"
             exit 1
        fi
        echo -e "  ${YELLOW}Proceeding, but deployment may fail if network is missing at runtime.${NC}"
    else
        check_ok "Network '$TRAEFIK_NETWORK' found"
    fi

    echo ""
    prompt_input "Base Domain (e.g. example.com)" "" DOMAIN_NAME
    if [ -z "$DOMAIN_NAME" ]; then
        echo -e "  ${RED}Domain name is required${NC}"
        exit 1
    fi
    
    prompt_input "Certificate Resolver" "letsencrypt" CERT_RESOLVER

    echo ""
    echo "  Service Subdomains:"
    
    prompt_input "Portal Domain" "$DOMAIN_NAME" PORTAL_DOMAIN
    prompt_input "Temporal UI Domain" "temporal.$DOMAIN_NAME" TEMPORAL_DOMAIN
    prompt_input "Grafana Domain" "grafana.$DOMAIN_NAME" GRAFANA_DOMAIN

    echo ""
    echo "  ${GREEN}Service URLs will be:${NC}"
    echo "    Portal:   https://$PORTAL_DOMAIN"
    echo "    Temporal: https://$TEMPORAL_DOMAIN"
    echo "    Grafana:  https://$GRAFANA_DOMAIN"
    echo ""
    
    # Git Configuration
    while true; do
        prompt_input "GitHub Token (ghp_...)" "" GITHUB_TOKEN
        if [ -z "$GITHUB_TOKEN" ]; then
            echo -e "  ${RED}GitHub token is required${NC}"
        elif [[ ! "$GITHUB_TOKEN" =~ ^github_pat_ ]] && [[ ${#GITHUB_TOKEN} -lt 10 ]]; then
             echo -e "  ${YELLOW}Warning: Token seems too short or malformed.${NC}"
             read -p "  Use this token anyway? [y/N]: " confirm_token
             if [[ "$confirm_token" =~ ^[Yy]$ ]]; then break; fi
        else
            break
        fi
    done
    
    # GitHub Repo
    while true; do
        prompt_input "GitHub Repo (owner/repo)" "" GITHUB_REPO
        if [ -z "$GITHUB_REPO" ]; then
            echo -e "  ${RED}GitHub repo is required${NC}"
        elif [[ ! "$GITHUB_REPO" =~ ^.+/.+$ ]]; then
             echo -e "  ${RED}Invalid format. Expected: owner/repo${NC}"
        else
             break
        fi
    done
    
    # Project Directory
    echo ""
    echo "  Project to work on:"
    echo ""
    prompt_input "Project directory (absolute path)" "$(pwd)" PROJECT_DIR
    if [ ! -d "$PROJECT_DIR" ]; then
        echo -e "  ${RED}Directory does not exist: $PROJECT_DIR${NC}"
        exit 1
    fi
    
    # Context Folder
    prompt_input "Context folder (relative to project)" "docs/context" CONTEXT_FOLDER
    
    # Google OAuth
    echo ""
    echo "  Authentication (Google OAuth):"
    echo "  Create credentials at: https://console.cloud.google.com/apis/credentials"
    echo ""
    prompt_input "Google Client ID" "" GOOGLE_CLIENT_ID
    if [ -z "$GOOGLE_CLIENT_ID" ]; then
        echo -e "  ${RED}Google Client ID is required for portal authentication${NC}"
        exit 1
    fi
    
    prompt_input "Google Client Secret" "" GOOGLE_CLIENT_SECRET
    if [ -z "$GOOGLE_CLIENT_SECRET" ]; then
        echo -e "  ${RED}Google Client Secret is required${NC}"
        exit 1
    fi
    
    # Generate NEXTAUTH_SECRET
    NEXTAUTH_SECRET=$(openssl rand -base64 32)
    
    # Email Notifications
    echo ""
    echo "  Email notifications (optional):"
    echo ""
    prompt_input "Email for notifications" "" EMAIL_TO
    
    if [ -n "$EMAIL_TO" ]; then
        prompt_input "Email provider (resend/sendgrid)" "resend" EMAIL_PROVIDER
        prompt_input "Email API Key" "" EMAIL_API_KEY
        prompt_input "Sender email" "ai-swarm@example.com" EMAIL_FROM
    fi
    
    # Chat retention
    echo ""
    echo "  Maintenance:"
    echo ""
    prompt_input "Chat retention days" "90" CHAT_MAX_AGE_DAYS
}

#==============================================================================
# GENERATE .ENV
#==============================================================================

generate_env_file() {
    print_section "📄 GENERATING .ENV"
    
    cat > "$ENV_FILE" << EOF
# AI Swarm v2 - Generated Configuration
# Generated: $(date)

# GitHub
GITHUB_TOKEN=$GITHUB_TOKEN
GITHUB_REPO=$GITHUB_REPO

# Project
PROJECT_DIR=$PROJECT_DIR
CONTEXT_FOLDER=$CONTEXT_FOLDER

# Traefik & Domain
DOMAIN_NAME=$DOMAIN_NAME
TRAEFIK_NETWORK=$TRAEFIK_NETWORK
CERT_RESOLVER=$CERT_RESOLVER
PORTAL_DOMAIN=$PORTAL_DOMAIN
TEMPORAL_DOMAIN=$TEMPORAL_DOMAIN
GRAFANA_DOMAIN=$GRAFANA_DOMAIN

# Service URLs (for Portal integration)
NEXT_PUBLIC_GRAFANA_URL=https://$GRAFANA_DOMAIN

# Authentication (Google OAuth)
NEXTAUTH_URL=https://$PORTAL_DOMAIN
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET

# Temporal
TEMPORAL_ADDRESS=temporal:7233
TEMPORAL_NAMESPACE=ai-swarm

# Ports
PORTAL_PORT=$PORTAL_PORT
TEMPORAL_UI_PORT=$TEMPORAL_UI_PORT
GRAFANA_PORT=$GRAFANA_PORT

# Email
EMAIL_PROVIDER=${EMAIL_PROVIDER:-resend}
EMAIL_API_KEY=${EMAIL_API_KEY:-}
EMAIL_FROM=${EMAIL_FROM:-}
EMAIL_TO=${EMAIL_TO:-}

# Deployment
DEPLOY_DIR=${DEPLOY_DIR:-}
DEPLOY_HOST=${DEPLOY_HOST:-localhost}
DEPLOY_USER=${DEPLOY_USER:-ubuntu}
DEPLOY_CONTAINER=${DEPLOY_CONTAINER:-}
SKIP_EXTERNAL_CI=${SKIP_EXTERNAL_CI:-false}

# Maintenance
CHAT_MAX_AGE_DAYS=$CHAT_MAX_AGE_DAYS

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
LOG_LEVEL=info

# Redis
REDIS_URL=redis://redis:6379
EOF

    check_ok "Created .env file"
}

#==============================================================================
# DEPLOY
#==============================================================================

deploy() {
    print_section "🚀 DEPLOYING"
    
    cd "$SCRIPT_DIR"
    
    # Build handled by Docker multi-stage builds

    
    # Start Docker Compose
    echo "  Starting containers..."
    docker compose up -d --build
    check_ok "Containers started"
    
    # Wait for Temporal
    echo "  Waiting for Temporal to be ready..."
    local retries=30
    while [ $retries -gt 0 ]; do
        if docker exec temporal tctl cluster health 2>/dev/null | grep -q "SERVING"; then
            break
        fi
        sleep 2
        retries=$((retries - 1))
    done
    
    if [ $retries -eq 0 ]; then
        check_warn "Temporal may not be fully ready yet"
    else
        check_ok "Temporal is ready"
    fi
    
    # Create namespace
    echo "  Creating Temporal namespace..."
    docker exec temporal tctl namespace register ai-swarm 2>/dev/null || true
    check_ok "Namespace created"
}

#==============================================================================
# POST-DEPLOY
#==============================================================================

post_deploy() {
    print_section "✅ DEPLOYMENT COMPLETE"
    
    echo ""
    echo -e "  ${GREEN}AI Swarm v2 is now running!${NC}"
    echo ""
    echo -e "  ${BOLD}NEXT STEP: Authenticate Gemini CLI${NC}"
    echo ""
    echo -e "  Run this command to authenticate all 4 workers:"
    echo -e "    ${CYAN}./auth-gemini.sh${NC}"
    echo ""
    echo -e "  ${BOLD}Access Points:${NC}"
    echo -e "    • Dashboard:   ${CYAN}https://$PORTAL_DOMAIN${NC}"
    echo -e "    • Temporal UI: ${CYAN}https://$TEMPORAL_DOMAIN${NC}"
    echo -e "    • Grafana:     ${CYAN}https://$GRAFANA_DOMAIN${NC} (admin/admin)"
    echo ""
    echo -e "  ${BOLD}Useful Commands:${NC}"
    echo -e "    • View logs:   ${CYAN}docker compose logs -f${NC}"
    echo -e "    • Stop:        ${CYAN}docker compose stop${NC}"
    echo -e "    • Tear down:   ${CYAN}./teardown.sh${NC}"
    echo ""
}

#==============================================================================
# MAIN
#==============================================================================

main() {
    print_header
    preflight_checks
    check_ports
    collect_configuration
    generate_env_file
    deploy
    post_deploy
}

main "$@"
