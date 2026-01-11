-- AI Swarm v3.0.0 - Complete Schema
-- Consolidated schema for fresh installations

-- ============================================================================
-- CORE APPLICATION TABLES
-- ============================================================================

-- Projects: SCM configuration per repository
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    scm_provider VARCHAR(50) NOT NULL,
    scm_org VARCHAR(255) NOT NULL,
    scm_project VARCHAR(255),
    scm_repo VARCHAR(255) NOT NULL,
    scm_token TEXT,
    base_path VARCHAR(255) DEFAULT '/project',
    context_folder VARCHAR(255) DEFAULT 'docs/context',
    ai_context_folder VARCHAR(255) DEFAULT '.aicontext',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Deployments: Environment-specific deploy targets
CREATE TABLE IF NOT EXISTS deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    ssh_host VARCHAR(255) NOT NULL,
    ssh_user VARCHAR(255) NOT NULL,
    deploy_dir VARCHAR(255) NOT NULL,
    app_url VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    metadata JSONB,
    UNIQUE(project_id, name)
);

-- Secrets: Sensitive credentials per project
CREATE TABLE IF NOT EXISTS secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    key VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    UNIQUE(project_id, key)
);

-- Prompts: Versioned system prompts for agents
CREATE TABLE IF NOT EXISTS prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    content TEXT NOT NULL,
    is_active BOOLEAN DEFAULT false,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(name, version)
);

-- Project Agent Config: Per-project LLM overrides
CREATE TABLE IF NOT EXISTS project_agent_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    llm_provider VARCHAR(50),
    prompt_id UUID REFERENCES prompts(id),
    UNIQUE(project_id, role)
);

-- ============================================================================
-- SYSTEM TABLES
-- ============================================================================

-- Worker health tracking
CREATE TABLE IF NOT EXISTS worker_health (
    worker_id VARCHAR(50) PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'offline',
    last_heartbeat TIMESTAMP,
    current_task_id UUID,
    llm_provider VARCHAR(20),
    metadata JSONB
);

-- System configuration (UI-managed settings)
CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    is_secret BOOLEAN DEFAULT false,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Audit Log: Track configuration changes
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(100) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- AUTHENTICATION TABLES (Sovereign Auth)
-- ============================================================================

-- Users: Single admin initially, expandable to multi-user
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Passkey Credentials (WebAuthn)
CREATE TABLE IF NOT EXISTS authenticators (
    credential_id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_public_key TEXT NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    credential_device_type VARCHAR(50) NOT NULL,
    credential_backed_up BOOLEAN DEFAULT false,
    transports TEXT,
    name VARCHAR(255) DEFAULT 'My Device',
    created_at TIMESTAMP DEFAULT NOW(),
    last_used_at TIMESTAMP
);

-- Magic Link Tokens: CLI-generated one-time login tokens
CREATE TABLE IF NOT EXISTS verification_tokens (
    token VARCHAR(255) PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    expires TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT false
);

-- WebAuthn Challenge Storage (for replay attack prevention)
CREATE TABLE IF NOT EXISTS auth_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,
    expires TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- DEFAULT DATA
-- ============================================================================

-- Default system config values
INSERT INTO system_config (key, value, is_secret) VALUES 
    ('worker_count', '4', false),
    ('claude_auth_mode', 'oauth', false),
    ('z_ai_api_key', '', true),
    ('scm_token_azure_devops', '', true),
    ('scm_token_github', '', true),
    ('scm_token_gitlab', '', true),
    ('default_project_dir', '/project', false),
    ('log_level', 'info', false),
    ('email_provider', 'resend', false),
    ('email_api_key', '', true),
    ('email_from', 'noreply@example.com', false),
    ('email_to', '', false),
    ('test_user_email', '', false),
    ('test_user_password', '', true),
    ('auth_mode', 'single_user', false),
    ('session_max_age_days', '7', false),
    ('session_absolute_max_days', '30', false),
    ('deployer_blacklist', 'temporal-server,postgres,redis,traefik,portainer,ai-swarm-portal,ai-swarm-worker-1,ai-swarm-worker-2,ai-swarm-worker-3,ai-swarm-worker-4,ai-swarm-worker-5,ai-swarm-worker-6,ai-swarm-worker-7,ai-swarm-worker-8,ai-swarm-playwright,ai-swarm-builder', false)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- GROWTH SCHEMA ADDITIONS (v3.0.0 Future-Proofing)
-- ============================================================================

-- 1. Multi-Tenancy
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member',
    PRIMARY KEY (organization_id, user_id)
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 2. Usage & Monetization
CREATE TABLE IF NOT EXISTS organization_quotas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    tokens_limit BIGINT DEFAULT 0,
    tokens_used BIGINT DEFAULT 0,
    usd_limit DECIMAL(12,2) DEFAULT 0,
    usd_used DECIMAL(12,2) DEFAULT 0,
    period VARCHAR(20) DEFAULT 'monthly',
    resets_at TIMESTAMP,
    metadata JSONB,
    UNIQUE(organization_id)
);

CREATE TABLE IF NOT EXISTS task_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id),
    workflow_id VARCHAR(255),
    role VARCHAR(50),
    llm_provider VARCHAR(50),
    status VARCHAR(20),
    tokens_in INT DEFAULT 0,
    tokens_out INT DEFAULT 0,
    cost_usd DECIMAL(12,6) DEFAULT 0,
    duration_ms INT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bounties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    external_id VARCHAR(255),
    url TEXT,
    amount DECIMAL(12,2),
    currency VARCHAR(10) DEFAULT 'USD',
    status VARCHAR(20) DEFAULT 'active',
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Infrastructure & Scaling
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'ssh';
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS provider_config JSONB;

CREATE TABLE IF NOT EXISTS managed_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    session_data_encrypted TEXT NOT NULL,
    expires_at TIMESTAMP,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    name VARCHAR(255),
    config JSONB,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255),
    cron_expression VARCHAR(100),
    workflow_type VARCHAR(100),
    workflow_args JSONB,
    is_active BOOLEAN DEFAULT true,
    last_run_at TIMESTAMP,
    next_run_at TIMESTAMP,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS worker_pools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE worker_health ADD COLUMN IF NOT EXISTS pool_id UUID REFERENCES worker_pools(id);

-- 4. Artifacts
CREATE TABLE IF NOT EXISTS artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    workflow_id VARCHAR(255),
    file_type VARCHAR(50),
    file_name VARCHAR(255),
    storage_path TEXT,
    size_bytes BIGINT,
    expires_at TIMESTAMP,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 5. Additional Future-Proofing
ALTER TABLE users ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE secrets ADD COLUMN IF NOT EXISTS metadata JSONB;

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255),
    key_hash VARCHAR(255) NOT NULL,
    key_prefix VARCHAR(10),
    scopes TEXT[],
    expires_at TIMESTAMP,
    last_used_at TIMESTAMP,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) UNIQUE NOT NULL,
    enabled BOOLEAN DEFAULT false,
    organization_id UUID REFERENCES organizations(id),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id),
    event_type VARCHAR(100) NOT NULL,
    channel VARCHAR(50) NOT NULL,
    is_enabled BOOLEAN DEFAULT true,
    metadata JSONB,
    UNIQUE(user_id, organization_id, event_type, channel)
);

CREATE TABLE IF NOT EXISTS user_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    resource_id UUID,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
