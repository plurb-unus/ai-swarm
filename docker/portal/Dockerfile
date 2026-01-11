# AI Swarm v3.0.0 - Portal
# Uses multi-stage build for optimal image size with node:20-slim

# --- Stage 1: Builder ---
FROM node:20-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

WORKDIR /app

# Copy configuration files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/workflows/package.json ./packages/workflows/
COPY packages/worker/package.json ./packages/worker/
COPY apps/portal/package.json ./apps/portal/

# Install dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source code
COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/workflows/ ./packages/workflows/
COPY packages/worker/ ./packages/worker/
COPY apps/portal/ ./apps/portal/

# Build all packages
RUN pnpm --filter @ai-swarm/shared build && \
    pnpm --filter @ai-swarm/workflows build && \
    pnpm --filter @ai-swarm/portal build


# --- Stage 2: Runner ---
FROM node:20-slim AS runner

# Install runtime system dependencies
# git/openssh: for SCM operations
# python3: for some node-gyp runtime bindings (just in case)
# ca-certificates/curl: for network ops
RUN apt-get update && apt-get install -y \
    git \
    openssh-client \
    python3 \
    make \
    g++ \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install global tools
RUN npm install -g pnpm @anthropic-ai/claude-code @google/gemini-cli

WORKDIR /app

# Install pg for migration script (not bundled in standalone)
RUN npm install pg

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy standalone build from builder
COPY --from=builder /app/apps/portal/.next/standalone ./
COPY --from=builder /app/apps/portal/.next/static ./apps/portal/.next/static
COPY --from=builder /app/apps/portal/public ./apps/portal/public

# Copy shared package migrations for auto-init
COPY --from=builder /app/packages/shared/dist/db/migrations /app/packages/shared/dist/db/migrations

# Copy local prompts (if applicable)
COPY packages/shared/prompts/ /opt/ai-swarm/prompts/

# Copy Claude settings template for Z.ai support
COPY packages/workflows/templates/claude-settings.json /opt/ai-swarm/templates/claude-settings.json

# Copy Sovereign Login CLI script
COPY scripts/sovereign-login.mjs /app/scripts/sovereign-login.mjs

# Install dependencies for entrypoint (gettext-base for envsubst, postgresql-client for pg_isready)
# Also install Temporal CLI for namespace management
RUN apt-get update && apt-get install -y gettext-base postgresql-client && \
    curl -sSf https://temporal.download/cli.sh | sh && \
    mv /root/.temporalio/bin/temporal /usr/local/bin/temporal && \
    rm -rf /var/lib/apt/lists/*

# Copy the automated entrypoint script
COPY docker/portal/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "apps/portal/server.js"]
