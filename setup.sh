#!/usr/bin/env bash
#
# AI Swarm v3.0.0 - Bootstrap Script
# Complete CLI-based setup: Configure environment -> Start containers -> Create admin
#

set -e

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure all scripts are executable
chmod +x "$SCRIPT_DIR/setup.sh" "$SCRIPT_DIR/scale-workers.sh" "$SCRIPT_DIR/auth-claude.sh" "$SCRIPT_DIR/auth-gemini.sh" "$SCRIPT_DIR/scripts/"*.sh 2>/dev/null || true

# Helper: Update or add variable in .env
update_env() {
    local key=$1
    local value=$2
    if grep -q "^${key}=" .env; then
        # Use a different delimiter for sed because URLs contain slashes
        sed -i "s|^${key}=.*|${key}=${value}|" .env
    else
        echo "${key}=${value}" >> .env
    fi
}

print_header() {
    clear
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}   AI Swarm v3.0.0 - Setup Wizard${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo "This script will configure your AI Swarm installation:"
    echo "  1. Check for existing configuration"
    echo "  2. Configure reverse proxy (Local/Caddy/Nginx/Traefik)"
    echo "  3. Generate SSH deployment key"
    echo "  4. Configure environment variables"
    echo "  5. Generate start/stop scripts"
    echo "  6. Start containers and create admin account"
    echo ""
}

print_success() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║${NC}              ${BOLD}AI Swarm v3.0.0 - Setup Complete!${NC}               ${GREEN}║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Your AI Swarm infrastructure is now running!"
    echo ""
    echo -e "  Portal:   ${BOLD}https://${PORTAL_DOMAIN}${NC}"
    echo -e "  Temporal: ${BOLD}https://${PORTAL_DOMAIN}/temporal${NC}"
    echo -e "  Help:     ${BOLD}https://${PORTAL_DOMAIN}/help${NC}"
    echo ""
    echo -e "${YELLOW}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║${NC}  ${BOLD}LLM Authentication (Required)${NC}                                ${YELLOW}║${NC}"
    echo -e "${YELLOW}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${YELLOW}║${NC}                                                               ${YELLOW}║${NC}"
    echo -e "${YELLOW}║${NC}  For Gemini (orchestration):                                 ${YELLOW}║${NC}"
    echo -e "${YELLOW}║${NC}    ${CYAN}./auth-gemini.sh${NC}                                          ${YELLOW}║${NC}"
    echo -e "${YELLOW}║${NC}                                                               ${YELLOW}║${NC}"
    echo -e "${YELLOW}║${NC}  For Claude (coding):                                        ${YELLOW}║${NC}"
    echo -e "${YELLOW}║${NC}    ${CYAN}./auth-claude.sh${NC}    (Pro/Max subscription)               ${YELLOW}║${NC}"
    echo -e "${YELLOW}║${NC}    OR set Z_AI_API_KEY in .env (API key)                     ${YELLOW}║${NC}"
    echo -e "${YELLOW}║${NC}                                                               ${YELLOW}║${NC}"
    echo -e "${YELLOW}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}Post-Installation Commands:${NC}"
    echo -e "  Scale workers:   ${CYAN}./scale-workers.sh [1-8]${NC}"
    echo -e "  New login link:  ${CYAN}./scripts/sovereign-login.sh [email]${NC}"
    echo -e "  View logs:       ${CYAN}docker compose logs -f${NC}"
    echo ""
    echo -e "${YELLOW}For troubleshooting, see:${NC}"
    echo -e "  ${BOLD}https://${PORTAL_DOMAIN}/help/troubleshooting${NC}"
    echo ""
}

check_existing_config() {
    echo -e "${BLUE}[1/6] Checking Existing Configuration...${NC}"
    
    cd "$SCRIPT_DIR"
    
    if [ -f ".env" ]; then
        echo -e "${YELLOW}  Existing .env file detected.${NC}"
        echo ""
        echo "  Options:"
        echo "    1) Keep existing configuration and just regenerate start/stop scripts"
        echo "    2) Backup existing and start fresh"
        echo "    3) Exit setup"
        echo ""
        read -p "  Choice [1-3]: " config_choice
        
        case $config_choice in
            1)
                echo -e "${GREEN}  ✓ Keeping existing configuration${NC}"
                KEEP_EXISTING=true
                ;;
            2)
                backup_file=".env.backup.$(date +%Y%m%d_%H%M%S)"
                cp .env "$backup_file"
                echo -e "${GREEN}  ✓ Backed up to: $backup_file${NC}"
                rm -f .env
                KEEP_EXISTING=false
                ;;
            3)
                echo "  Exiting."
                exit 0
                ;;
            *)
                echo -e "${RED}  Invalid choice. Exiting.${NC}"
                exit 1
                ;;
        esac
    else
        KEEP_EXISTING=false
        if [ -f ".env.example" ]; then
            cp .env.example .env
            echo -e "${GREEN}  ✓ Initialized .env from .env.example${NC}"
        else
            touch .env
            echo -e "${GREEN}  ✓ Created new .env file${NC}"
        fi
        # Lock project name for consistent container naming
        echo "COMPOSE_PROJECT_NAME=ai-swarm" >> .env
    fi
}

step_1_proxy_selection() {
    echo -e "${BLUE}[2/6] Reverse Proxy Configuration...${NC}"
    
    cd "$SCRIPT_DIR"
    
    # Load environment variables
    set -a
    source .env 2>/dev/null || true
    set +a
    
    if [ "$KEEP_EXISTING" = true ] && [ -n "$PROXY_MODE" ]; then
        echo -e "${GREEN}  ✓ PROXY_MODE: ${PROXY_MODE}${NC}"
        return
    fi
    
    echo ""
    echo -e "${YELLOW}Select your reverse proxy configuration:${NC}"
    echo ""
    echo "  1) local   - Direct port exposure, no SSL"
    echo "               Best for: Evaluation, local development"
    echo "               Access via: http://localhost:3000"
    echo ""
    echo "  2) caddy   - Bundled Caddy with automatic HTTPS (Recommended)"
    echo "               Best for: Production, easy SSL setup"
    echo "               Access via: https://yourdomain.com"
    echo ""
    echo "  3) nginx   - Bundled Nginx with manual certificates"
    echo "               Best for: Existing cert workflow, custom configs"
    echo "               Access via: https://yourdomain.com"
    echo ""
    echo "  4) traefik - External Traefik instance"
    echo "               Best for: Existing Traefik infrastructure"
    echo "               Access via: https://yourdomain.com"
    echo ""
    
    # Auto-detect existing Traefik
    if command -v docker >/dev/null 2>&1; then
        if docker network ls --format '{{.Name}}' | grep -qE "^(web-gateway|traefik-public)$"; then
            echo -e "  ${CYAN}(Detected existing Traefik network)${NC}"
            echo ""
        fi
    fi
    
    read -p "  Choice [1-4, default: 1]: " proxy_choice
    
    case "$proxy_choice" in
        1|"")
            PROXY_MODE="local"
            ;;
        2)
            PROXY_MODE="caddy"
            ;;
        3)
            PROXY_MODE="nginx"
            ;;
        4)
            PROXY_MODE="traefik"
            ;;
        *)
            echo -e "${RED}  Invalid choice. Using 'local'.${NC}"
            PROXY_MODE="local"
            ;;
    esac
    
    update_env "PROXY_MODE" "$PROXY_MODE"
    echo -e "${GREEN}  ✓ PROXY_MODE set to: $PROXY_MODE${NC}"

    # Additional config for non-local modes (caddy, nginx, traefik)
    if [ "$PROXY_MODE" != "local" ]; then
        # Always prompt for domain if not set, empty, or still set to default 'localhost'
        # Note: .env.example has PORTAL_DOMAIN=localhost as placeholder
        if [ -z "$PORTAL_DOMAIN" ] || [ "$PORTAL_DOMAIN" = "" ] || [ "$PORTAL_DOMAIN" = "localhost" ]; then
            echo ""
            read -p "  Portal Domain (e.g., swarm.yourdomain.com): " portal_domain
            if [ -n "$portal_domain" ]; then
                update_env "PORTAL_DOMAIN" "$portal_domain"
                update_env "NEXTAUTH_URL" "https://$portal_domain"
                PORTAL_DOMAIN="$portal_domain"
                echo -e "${GREEN}  ✓ PORTAL_DOMAIN set to: $portal_domain${NC}"
            else
                echo -e "${YELLOW}  Warning: No domain provided. You'll need to set PORTAL_DOMAIN in .env manually.${NC}"
            fi
        else
            echo -e "${GREEN}  ✓ PORTAL_DOMAIN: $PORTAL_DOMAIN${NC}"
        fi

        # Certificate helper for Nginx/Caddy
        if [[ "$PROXY_MODE" == "caddy" || "$PROXY_MODE" == "nginx" ]]; then
            cert_dir="$SCRIPT_DIR/docker/$PROXY_MODE/certs"
            if [ ! -f "$cert_dir/server.crt" ]; then
                echo ""
                echo -e "${YELLOW}  No SSL certificates found in $cert_dir${NC}"
                read -p "  Generate self-signed certificates for testing? [Y/n]: " gen_certs
                if [[ ! "$gen_certs" =~ ^[Nn]$ ]]; then
                    mkdir -p "$cert_dir"
                    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
                        -keyout "$cert_dir/server.key" \
                        -out "$cert_dir/server.crt" \
                        -subj "/C=US/ST=NC/L=Durham/O=AI Swarm/CN=${PORTAL_DOMAIN:-localhost}" >/dev/null 2>&1
                    echo -e "${GREEN}  ✓ Self-signed certificates generated${NC}"
                fi
            fi
        fi
        
        if [ "$PROXY_MODE" = "caddy" ]; then
            echo ""
            echo -e "${YELLOW}  Let's Encrypt Rate Limit Warning:${NC}"
            echo "  Let's Encrypt allows only 5 duplicate certs per week."
            echo "  For testing, we recommend using the staging CA."
            echo ""
            read -p "  Use staging CA for testing? [Y/n]: " use_staging
            if [[ ! "$use_staging" =~ ^[Nn]$ ]]; then
                echo "ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory" >> .env
                echo -e "${GREEN}  ✓ Using Let's Encrypt staging (browser will show cert warning)${NC}"
            fi
            
            read -p "  ACME Email (for cert notifications): " acme_email
            if [ -n "$acme_email" ]; then
                echo "ACME_EMAIL=$acme_email" >> .env
            fi
        fi
        
        if [ "$PROXY_MODE" = "traefik" ]; then
            echo ""
            read -p "  Traefik Network [default: web-gateway]: " traefik_net
            echo "TRAEFIK_NETWORK=${traefik_net:-web-gateway}" >> .env
            
            read -p "  Cert Resolver [default: letsencrypt]: " cert_res
            echo "CERT_RESOLVER=${cert_res:-letsencrypt}" >> .env
            
            # IMPORTANT: Set COMPOSE_FILE so all docker compose commands include traefik overlay
            echo "COMPOSE_FILE=docker-compose.yml:docker-compose.traefik.yml" >> .env
        fi
    else
        # Local mode defaults
        update_env "PORTAL_DOMAIN" "localhost"
        update_env "NEXTAUTH_URL" "http://localhost:3000"
        PORTAL_DOMAIN="localhost"
    fi
}

step_2_env_setup() {
    echo -e "${BLUE}[3/6] Environment Configuration...${NC}"
    
    cd "$SCRIPT_DIR"
    
    # Load environment variables
    set -a
    source .env 2>/dev/null || true
    set +a
    
    if [ "$KEEP_EXISTING" = true ]; then
        echo -e "${GREEN}  ✓ Using existing environment configuration${NC}"
        return
    fi
    
    # === WORKER COUNT SELECTION ===
    if [ -z "$WORKER_COUNT" ]; then
        echo ""
        echo -e "${YELLOW}Worker Configuration${NC}"
        echo "How many parallel workers (1-8) would you like to start?"
        echo -e "${CYAN}Note: Each worker uses ~512MB-1GB RAM. Start with 4 and adjust.${NC}"
        
        while true; do
            read -p "  Worker Count (1-8) [default: 4]: " worker_input
            worker_input=${worker_input:-4}
            if [[ "$worker_input" =~ ^[1-8]$ ]]; then
                WORKER_COUNT="$worker_input"
                break
            else
                echo -e "${RED}  Invalid input. Please enter a number between 1 and 8.${NC}"
            fi
        done
        
        update_env "WORKER_COUNT" "$WORKER_COUNT"
        echo -e "${GREEN}  ✓ WORKER_COUNT set to: $WORKER_COUNT${NC}"
    else
        echo -e "${GREEN}  ✓ WORKER_COUNT: ${WORKER_COUNT}${NC}"
    fi
    
    # === WORKSPACE ROOT CONFIGURATION ===
    if [ -z "$WORKSPACE_ROOT" ]; then
        echo ""
        echo -e "${YELLOW}Workspace Root Configuration${NC}"
        echo "Where are your project codebases located?"
        echo "This directory will be mounted into containers at /apps"
        echo ""
        
        default_workspace="$SCRIPT_DIR/workspace"
        read -p "  Workspace Root [default: $default_workspace]: " workspace_root
        WORKSPACE_ROOT=${workspace_root:-$default_workspace}
        
        # Create if doesn't exist
        if [ ! -d "$WORKSPACE_ROOT" ]; then
            mkdir -p "$WORKSPACE_ROOT"
            echo -e "${GREEN}  ✓ Created workspace directory${NC}"
        fi
        
        echo "WORKSPACE_ROOT=$WORKSPACE_ROOT" >> .env
        echo -e "${GREEN}  ✓ WORKSPACE_ROOT set to: $WORKSPACE_ROOT${NC}"
    else
        echo -e "${GREEN}  ✓ WORKSPACE_ROOT: ${WORKSPACE_ROOT}${NC}"
    fi
    
    # Reload env
    set -a
    source .env 2>/dev/null || true
    set +a
}
    
step_3_secrets() {
    echo -e "${BLUE}[4/6] Generating Secrets...${NC}"
    
    cd "$SCRIPT_DIR"
    
    # Load environment variables
    set -a
    source .env 2>/dev/null || true
    set +a
    
    # === NEXTAUTH_SECRET (Auto-generate) ===
    if [ -z "$NEXTAUTH_SECRET" ]; then
        nextauth_secret=$(openssl rand -base64 32)
        echo "NEXTAUTH_SECRET=$nextauth_secret" >> .env
        echo -e "${GREEN}  ✓ NEXTAUTH_SECRET generated${NC}"
    else
        echo -e "${GREEN}  ✓ NEXTAUTH_SECRET exists${NC}"
    fi
}

step_4_ssh_key() {
    echo -e "${BLUE}[5/6] SSH Deployment Key...${NC}"
    
    # Ensure .ssh directory exists
    mkdir -p "${HOME}/.ssh"
    chmod 700 "${HOME}/.ssh"
    
    SSH_KEY_PATH="${HOME}/.ssh/ai-swarm-deploy"
    
    if [ ! -f "$SSH_KEY_PATH" ]; then
        echo -e "${YELLOW}  Generating new SSH key for deployments...${NC}"
        ssh-keygen -t ed25519 -f "$SSH_KEY_PATH" -N "" -C "ai-swarm-deploy" > /dev/null 2>&1
        echo -e "${GREEN}  ✓ SSH key generated${NC}"
    else
        echo -e "${GREEN}  ✓ SSH key exists: ${SSH_KEY_PATH}${NC}"
    fi
    
    # Add to .env
    grep -q "^SSH_KEY_PATH=" .env || echo "SSH_KEY_PATH=$SSH_KEY_PATH" >> .env
    grep -q "^SSH_KNOWN_HOSTS=" .env || echo "SSH_KNOWN_HOSTS=${HOME}/.ssh/known_hosts" >> .env
    
    echo ""
    echo -e "${YELLOW}============================================================${NC}"
    echo -e "${YELLOW}  SSH DEPLOY KEY - Add this to your deployment servers${NC}"
    echo -e "${YELLOW}============================================================${NC}"
    echo ""
    cat "${SSH_KEY_PATH}.pub"
    echo ""
    echo -e "${YELLOW}============================================================${NC}"
    echo ""
    echo "On each server you want AI Swarm to deploy to, run:"
    echo -e "  ${CYAN}echo '<paste-key-above>' >> ~/.ssh/authorized_keys${NC}"
    echo ""
    echo -e "${CYAN}For same-host deployment, add to your local authorized_keys too.${NC}"
    echo ""
    
    read -p "  Would you like to authorize this key for the local machine? [Y/n]: " authorize_key
    if [[ ! "$authorize_key" =~ ^[Nn]$ ]]; then
        cat "${SSH_KEY_PATH}.pub" >> "${HOME}/.ssh/authorized_keys"
        chmod 600 "${HOME}/.ssh/authorized_keys"
        echo -e "${GREEN}  ✓ Public key added to ${HOME}/.ssh/authorized_keys${NC}"
    fi
    
    read -p "  Press Enter to continue..." dummy
}

step_5_generate_scripts() {
    echo -e "${BLUE}[6/6] Generating Start/Stop Scripts...${NC}"
    
    cd "$SCRIPT_DIR"
    
    # Load environment variables
    set -a
    source .env 2>/dev/null || true
    set +a
    
    PROXY_MODE=${PROXY_MODE:-local}
    
    # Generate start.sh
    cat > start.sh << 'EOF'
#!/bin/bash
# AI Swarm v3.0.0 - Start Script
cd "$(dirname "${BASH_SOURCE[0]}")"

# Load current proxy mode
set -a
source .env 2>/dev/null || true
set +a
PROXY_MODE=${PROXY_MODE:-local}
if [ "$PROXY_MODE" = "local" ]; then
    docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --remove-orphans
else
    docker compose -f docker-compose.yml -f docker-compose.${PROXY_MODE}.yml up -d --remove-orphans
fi

# Fix volume permissions
echo "Ensuring volume permissions..."
docker exec -u root ai-swarm-worker-1 bash -c 'chown -R worker:worker /home/workers_root /home/shared_oauth 2>/dev/null' || true

echo ""
echo "AI Swarm started with ${PROXY_MODE} proxy mode."
echo "Portal: ${NEXTAUTH_URL:-http://localhost:3000}"
EOF
    chmod +x start.sh
    echo -e "${GREEN}  ✓ Created start.sh (Dynamic)${NC}"
    
    # Generate stop.sh
    cat > stop.sh << 'EOF'
#!/bin/bash
# AI Swarm v3.0.0 - Stop Script
cd "$(dirname "${BASH_SOURCE[0]}")"

# Load current proxy mode
set -a
source .env 2>/dev/null || true
set +a
PROXY_MODE=${PROXY_MODE:-local}

if [ "$PROXY_MODE" = "local" ]; then
    docker compose -f docker-compose.yml -f docker-compose.local.yml down
else
    docker compose -f docker-compose.yml -f docker-compose.${PROXY_MODE}.yml down
fi
echo "AI Swarm stopped."
EOF
    chmod +x stop.sh
    echo -e "${GREEN}  ✓ Created stop.sh (Dynamic)${NC}"
    
    echo -e "${GREEN}  ✓ Use ./start.sh to start and ./stop.sh to stop${NC}"
}

step_6_start_containers() {
    echo -e "${BLUE}Starting Containers...${NC}"
    
    cd "$SCRIPT_DIR"
    
    # Load environment variables
    set -a
    source .env 2>/dev/null || true
    set +a
    
    PROXY_MODE=${PROXY_MODE:-local}
    
    echo "  Starting with ${PROXY_MODE} proxy configuration..."
    if [ "$PROXY_MODE" = "local" ]; then
        docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --remove-orphans
    else
        docker compose -f docker-compose.yml -f docker-compose.${PROXY_MODE}.yml up -d --remove-orphans
    fi
    echo -e "${GREEN}  ✓ Containers starting${NC}"
    
    # Fix volume permissions for worker UID 1001
    echo "  Fixing volume permissions..."
    sleep 3  # Wait for workers to be created
    docker exec -u root ai-swarm-worker-1 bash -c 'chown -R worker:worker /home/workers_root /home/shared_oauth 2>/dev/null' 2>/dev/null || true
    echo -e "${GREEN}  ✓ Volume permissions fixed${NC}"
    
    echo "  Waiting for Temporal to be ready..."
    sleep 8
    
    echo "  Registering Temporal namespace..."
    docker exec temporal tctl --address temporal:7233 --namespace ai-swarm namespace register 2>/dev/null || echo "  (Namespace already exists)"
    
    echo -e "${GREEN}  ✓ Infrastructure ready${NC}"
}

wait_for_portal() {
    echo ""
    echo -e "${BLUE}Waiting for Portal to be ready...${NC}"
    
    # Load env for domain
    set -a
    source .env 2>/dev/null || true
    set +a
    
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORTAL_PORT:-3000}" | grep -q "200\|302"; then
            echo -e "${GREEN}  ✓ Portal is ready${NC}"
            return 0
        fi
        echo "  Attempt $attempt/$max_attempts - waiting..."
        sleep 2
        ((attempt++))
    done
    
    echo -e "${YELLOW}  Portal may still be starting. Check 'docker compose logs portal'${NC}"
}

step_7_admin_setup() {
    echo -e "${BLUE}Admin Account Setup...${NC}"
    
    cd "$SCRIPT_DIR"
    
    echo ""
    echo -e "${YELLOW}Admin Account Creation${NC}"
    echo "Enter the email address for the initial admin account."
    echo "A magic link will be generated for your first login."
    echo ""
    
    read -p "  Admin Email [default: admin@localhost]: " admin_email
    ADMIN_EMAIL=${admin_email:-admin@localhost}
    
    echo ""
    echo "  Creating admin account and generating magic link..."
    echo ""
    
    # Wait a moment for the database to be fully initialized
    sleep 3
    
    # Execute sovereign-login inside the portal container
    # Ignore "Single-User Mode" errors during setup; the goal is just to have an admin account ready
    docker exec ai-swarm-portal node /app/scripts/sovereign-login.mjs "$ADMIN_EMAIL" || echo -e "${CYAN}  (Admin account already exists or in single-user mode)${NC}"
    
    echo ""
    echo -e "${GREEN}  ✓ Admin account ready${NC}"
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

print_header
read -p "Press Enter to begin..." dummy
echo ""

check_existing_config
step_1_proxy_selection
step_2_env_setup
step_3_secrets
step_4_ssh_key
step_5_generate_scripts
step_6_start_containers
wait_for_portal
step_7_admin_setup
print_success
