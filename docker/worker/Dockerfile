# AI Swarm v3.0.0 - Slim Worker Image (~600-800MB)
# Multi-stage build for optimized size and fast rebuilds
# Note: Uses Debian slim (not Alpine) because Temporal SDK requires glibc

# =============================================================================
# STAGE 1: Builder - Compile TypeScript and install dependencies
# =============================================================================
FROM node:20-slim AS builder

# Build-time dependencies (not included in final image)
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN npm install -g pnpm

WORKDIR /app

# Copy package files first (layer caching optimization)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/workflows/package.json ./packages/workflows/
COPY packages/worker/package.json ./packages/worker/

# Install all dependencies (cached unless package.json changes)
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source code (invalidates cache on code changes)
COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/workflows/ ./packages/workflows/
COPY packages/worker/ ./packages/worker/

# Build all packages
RUN pnpm --filter @ai-swarm/shared build && \
    pnpm --filter @ai-swarm/workflows build && \
    pnpm --filter @ai-swarm/worker build

# Prune dev dependencies for smaller node_modules
RUN pnpm prune --prod

# =============================================================================
# STAGE 2: Runtime - Minimal production image
# =============================================================================
FROM node:20-slim AS runtime

# Runtime-only system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    openssh-client \
    bash \
    gettext-base \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI only (not full daemon) - ~50MB vs ~400MB
# Using static binary from official Docker releases
# v27.4.1 supports API version 1.44+ required by newer Docker daemons
ARG DOCKER_VERSION=27.4.1
RUN curl -fsSL "https://download.docker.com/linux/static/stable/$(uname -m)/docker-${DOCKER_VERSION}.tgz" \
    | tar -xz --strip-components=1 -C /usr/local/bin docker/docker \
    && chmod +x /usr/local/bin/docker

# Install Gemini CLI and Claude Code globally
RUN npm install -g @anthropic-ai/claude-code @google/gemini-cli pnpm

WORKDIR /app

# Copy compiled code and production dependencies from builder
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder /app/packages/workflows/package.json ./packages/workflows/
COPY --from=builder /app/packages/workflows/dist ./packages/workflows/dist
COPY --from=builder /app/packages/workflows/node_modules ./packages/workflows/node_modules
COPY --from=builder /app/packages/worker/package.json ./packages/worker/
COPY --from=builder /app/packages/worker/dist ./packages/worker/dist
COPY --from=builder /app/packages/worker/node_modules ./packages/worker/node_modules

# Copy templates and prompts
COPY docker/worker/templates/ /opt/ai-swarm/templates/
COPY packages/shared/prompts/ /opt/ai-swarm/prompts/
COPY packages/workflows/templates/claude-settings.json /opt/ai-swarm/templates/claude-settings.json

# Create non-root user with UID 1001 (for worktree permission fix)
# Also create symlinks for Gemini auth so interactive login persists to shared volume
RUN useradd -m -s /bin/bash -u 1001 worker && \
    mkdir -p /home/worker/.claude && \
    mkdir -p /home/worker/.config && \
    mkdir -p /home/shared_oauth/gemini-settings && \
    mkdir -p /home/shared_oauth/gemini && \
    ln -sfn /home/shared_oauth/gemini-settings /home/worker/.gemini && \
    ln -sfn /home/shared_oauth/gemini /home/worker/.config/google-gemini-cli && \
    chown -R worker:worker /home/worker /home/shared_oauth

# Create entrypoint script with umask fix
# Create entrypoint script with Hostname-based Isolation
RUN echo '#!/bin/bash' > /entrypoint.sh && \
    echo 'umask 0002' >> /entrypoint.sh && \
    echo '' >> /entrypoint.sh && \
    echo '# ----------------------------------------------------------------' >> /entrypoint.sh && \
    echo '# HOSTNAME-BASED ISOLATION (v3.0.0)' >> /entrypoint.sh && \
    echo '# Ensures unique workspace per replica in shared volume' >> /entrypoint.sh && \
    echo '# ----------------------------------------------------------------' >> /entrypoint.sh && \
    echo 'export WORKER_ID=${HOSTNAME}' >> /entrypoint.sh && \
    echo 'WORKER_HOME="/home/workers_root/${HOSTNAME}"' >> /entrypoint.sh && \
    echo 'echo "Initializing worker: ${WORKER_ID} at ${WORKER_HOME}"' >> /entrypoint.sh && \
    echo '' >> /entrypoint.sh && \
    echo 'mkdir -p "${WORKER_HOME}"' >> /entrypoint.sh && \
    echo 'mkdir -p "${WORKER_HOME}/.ssh"' >> /entrypoint.sh && \
    echo 'mkdir -p "${WORKER_HOME}/.config"' >> /entrypoint.sh && \
    echo '' >> /entrypoint.sh && \
    echo '# 1. SSH Keys: Copy from readonly mount to unique home' >> /entrypoint.sh && \
    echo 'if [ -f /home/worker/.ssh/id_ed25519 ]; then' >> /entrypoint.sh && \
    echo '  cp /home/worker/.ssh/id_ed25519 "${WORKER_HOME}/.ssh/"' >> /entrypoint.sh && \
    echo '  cp /home/worker/.ssh/known_hosts "${WORKER_HOME}/.ssh/"' >> /entrypoint.sh && \
    echo '  chmod 600 "${WORKER_HOME}/.ssh/id_ed25519"' >> /entrypoint.sh && \
    echo 'fi' >> /entrypoint.sh && \
    echo '' >> /entrypoint.sh && \
    echo '# 2. Claude Auth: Symlink to shared OAuth volume' >> /entrypoint.sh && \
    echo 'mkdir -p /home/shared_oauth/claude' >> /entrypoint.sh && \
    echo 'ln -sfn /home/shared_oauth/claude "${WORKER_HOME}/.claude"' >> /entrypoint.sh && \
    echo '' >> /entrypoint.sh && \
    echo '# 3. Gemini Auth: Symlink to shared OAuth volume' >> /entrypoint.sh && \
    echo 'mkdir -p /home/shared_oauth/gemini' >> /entrypoint.sh && \
    echo 'mkdir -p /home/shared_oauth/gemini-settings' >> /entrypoint.sh && \
    echo 'ln -sfn /home/shared_oauth/gemini "${WORKER_HOME}/.config/google-gemini-cli"' >> /entrypoint.sh && \
    echo 'ln -sfn /home/shared_oauth/gemini-settings "${WORKER_HOME}/.gemini"' >> /entrypoint.sh && \
    echo '' >> /entrypoint.sh && \
    echo '# 4. Git Identity' >> /entrypoint.sh && \
    echo 'if [ ! -f "${WORKER_HOME}/.gitconfig" ]; then' >> /entrypoint.sh && \
    echo '  git config --file "${WORKER_HOME}/.gitconfig" user.name "AI Swarm ${WORKER_ID}"' >> /entrypoint.sh && \
    echo '  git config --file "${WORKER_HOME}/.gitconfig" user.email "ai-swarm-${WORKER_ID}@swarm.local"' >> /entrypoint.sh && \
    echo 'fi' >> /entrypoint.sh && \
    echo '' >> /entrypoint.sh && \
    echo '# 5. Claude Z.ai Fallback' >> /entrypoint.sh && \
    echo 'if [ -n "$Z_AI_API_KEY" ]; then' >> /entrypoint.sh && \
    echo '  envsubst < /opt/ai-swarm/templates/claude-settings.json > "${WORKER_HOME}/.claude/settings.json"' >> /entrypoint.sh && \
    echo 'fi' >> /entrypoint.sh && \
    echo '' >> /entrypoint.sh && \
    echo '# Set HOME to the unique directory' >> /entrypoint.sh && \
    echo 'export HOME="${WORKER_HOME}"' >> /entrypoint.sh && \
    echo 'cd "${HOME}"' >> /entrypoint.sh && \
    echo '' >> /entrypoint.sh && \
    echo 'exec "$@"' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

# Environment variables
ENV NODE_ENV=production
ENV TEMPORAL_ADDRESS=temporal:7233
ENV TEMPORAL_NAMESPACE=ai-swarm
ENV HOME=/home/worker
ENV DOCKER_HOST=tcp://socket-proxy:2375

ENTRYPOINT ["/entrypoint.sh"]
# Use absolute path since entrypoint changes to HOME directory
CMD ["node", "/app/packages/worker/dist/index.js"]
