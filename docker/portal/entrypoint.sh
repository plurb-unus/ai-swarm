#!/bin/bash
set -e

# AI Swarm v3.0.0 - Portal Entrypoint
# Handles database migrations, seeding, and Temporal namespace initialization

echo "Starting AI Swarm Portal Initialization..."

# 1. Wait for Postgres to be ready
echo "Waiting for Postgres at ${POSTGRES_HOST}:${POSTGRES_PORT:-5432}..."
until PGPASSWORD=$POSTGRES_PASSWORD pg_isready -h $POSTGRES_HOST -p ${POSTGRES_PORT:-5432} -U $POSTGRES_USER; do
  echo "Postgres is unavailable - sleeping"
  sleep 2
done
echo "Postgres is ready"

# 2. Run Database Migrations
echo "Running database migrations..."
# We use the built standalone server but we can run a small script to trigger migrations
# The @ai-swarm/shared package is bundled in the standalone app
node -e "
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    user: process.env.POSTGRES_USER || 'temporal',
    host: process.env.POSTGRES_HOST || 'postgres',
    database: process.env.POSTGRES_DB || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'temporal',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
});

async function runMigrations() {
    const migrationsDir = '/app/packages/shared/dist/db/migrations';
    if (!fs.existsSync(migrationsDir)) {
        console.error('Migrations directory not found:', migrationsDir);
        process.exit(1);
    }
    
    const files = fs.readdirSync(migrationsDir).sort();
    console.log('Found', files.length, 'migration files');
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const file of files) {
            if (file.endsWith('.sql')) {
                console.log('Running migration:', file);
                const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
                await client.query(sql);
            }
        }
        await client.query('COMMIT');
        console.log('Migrations completed successfully');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', err);
        process.exit(1);
    } finally {
        client.release();
    }
}

async function seedPrompts() {
    const promptsPath = '/opt/ai-swarm/prompts';
    if (!fs.existsSync(promptsPath)) {
        console.log('Prompts path not found, skipping seed');
        return;
    }
    
    const files = fs.readdirSync(promptsPath);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const file of files) {
            if (file.endsWith('.md')) {
                const name = file.replace('.md', '');
                const content = fs.readFileSync(path.join(promptsPath, file), 'utf8');
                await client.query(
                    'INSERT INTO prompts (name, version, content, is_active) VALUES (\$1, 1, \$2, true) ON CONFLICT (name, version) DO NOTHING',
                    [name, content]
                );
                console.log('Seeded prompt:', name);
            }
        }
        await client.query('COMMIT');
        console.log('Seeding completed successfully');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Seeding failed:', err);
    } finally {
        client.release();
    }
}

async function seedSystemConfig() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const configs = [
            ['deployer_blacklist', 'temporal-server,postgres,redis,traefik,portainer,ai-swarm-portal,ai-swarm-worker-1,ai-swarm-worker-2,ai-swarm-worker-3,ai-swarm-worker-4,ai-swarm-worker-5,ai-swarm-worker-6,ai-swarm-worker-7,ai-swarm-worker-8,ai-swarm-playwright,ai-swarm-builder', false]
        ];
        
        for (const [key, value, isSecret] of configs) {
            await client.query(
                'INSERT INTO system_config (key, value, is_secret) VALUES (\$1, \$2, \$3) ON CONFLICT (key) DO NOTHING',
                [key, value, isSecret]
            );
            console.log('Ensured system config:', key);
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('System config seeding failed:', err);
    } finally {
        client.release();
    }
}

async function init() {
    await runMigrations();
    await seedPrompts();
    await seedSystemConfig();
    await pool.end();
}

init().catch(err => {
    console.error('Init failed:', err);
    process.exit(1);
});
"

# 3. Create Temporal Namespace
echo "Ensuring Temporal namespace 'ai-swarm' exists..."
# Use temporal CLI if available, or just ignore errors if it already exists
# We address the temporal server at TEMPORAL_ADDRESS
# Wait for temporal to be reachable
echo "Waiting for Temporal at ${TEMPORAL_ADDRESS}..."
# Temporal doesn't have a simple isready, so we just try to create namespace with retries
MAX_RETRIES=10
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if temporal operator namespace create -n ai-swarm --address $TEMPORAL_ADDRESS 2>/dev/null; then
        echo "Namespace 'ai-swarm' created"
        break
    elif temporal operator namespace describe -n ai-swarm --address $TEMPORAL_ADDRESS >/dev/null 2>&1; then
        echo "Namespace 'ai-swarm' already exists"
        break
    fi
    echo "Temporal not ready (attempt $((RETRY_COUNT+1))/$MAX_RETRIES) - sleeping"
    sleep 5
    RETRY_COUNT=$((RETRY_COUNT+1))
done

# 5. Sync CLI tool configurations from shared OAuth volume
# Priority: 1) Shared OAuth (from auth-*.sh), 2) Env var template
sync_cli_configs() {
  local shared_oauth="/home/shared_oauth"
  local home_dir="/home/node"
  
  # Claude
  if [ -f "$shared_oauth/claude/settings.json" ]; then
    mkdir -p "$home_dir/.claude"
    cp "$shared_oauth/claude/settings.json" "$home_dir/.claude/settings.json"
    echo "Synced Claude config from shared volume"
  elif [ -n "$Z_AI_API_KEY" ]; then
    mkdir -p "$home_dir/.claude"
    envsubst < /opt/ai-swarm/templates/claude-settings.json > "$home_dir/.claude/settings.json"
    echo "Configured Claude from Z_AI_API_KEY env var"
  else
    mkdir -p "$home_dir/.claude"
    echo "No Claude configuration found - run auth-claude.sh to authenticate"
  fi
  
  # Gemini
  if [ -d "$shared_oauth/gemini" ]; then
    mkdir -p "$home_dir/.gemini"
    cp -r "$shared_oauth/gemini/"* "$home_dir/.gemini/" 2>/dev/null || true
    echo "Synced Gemini config from shared volume"
  fi
  
  # Future CLI tools can be added here
}

sync_cli_configs

echo "Initialization complete. Starting Portal..."
exec "$@"
