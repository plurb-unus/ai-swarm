# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Claude CLI processes now have 10-minute timeout and proper cleanup to prevent zombie process accumulation

## [3.0.1] - 2026-01-09

### Added
- Multi-role LLM alignment for `updateProjectContext` (Reviewer role) and `reviewVisualDeployment` (Deployer role).
- Automated GHCR image publishing via GitHub Actions on release creation
- Multi-arch builds (AMD64 + ARM64) with native runners (no QEMU)

### Changed
- Changelog now follows Keep a Changelog format with `[Unreleased]` section

### Fixed
- Portal Planner JSON extraction now handles explanatory text before JSON (allows "Create Task from Plan" button to appear)
- Simplified task submission: Submit Task button always visible after first planner response (no more complex JSON detection)
- Plan JSON detection now handles markdown code fences (LLM responses wrapped in ```json blocks)
- Temporal UI link auto-derives from `PORTAL_DOMAIN/temporal` for path-based routing
- SCM token lookup now checks: project.scmToken -> secrets table -> global provider token
- Clearing SCM token in project form now persists correctly (empty string was being omitted)
- Playwright screenshot capture uses base64+temp file to avoid shell escaping issues
- Portal "Create Task from Plan" now includes projectId (fixes multi-project worktree resolution)
- updateProjectContext now validates LLM response fields (prevents undefined path errors)
- Playwright temp scripts now use NODE_PATH to find playwright module
- Gemini auth now shared between interactive login and runtime via symlinks to shared OAuth volume

### Removed

## [3.0.0] - 2026-01-06

### Breaking Changes

> [!CAUTION]
> **No upgrade path from v2.1**: This is a complete rewrite. If you are running v2.1, you must perform a fresh installation. Database schemas, environment variables, and configuration files are not compatible.

### Major Changes & New Features
- **Temporal.io Orchestration**: Migrated the core "brain" from custom bash/node scripts to Temporal.io. This enables durable execution, automatic retries across server restarts, and deep observability of workflow state.
- **Sovereign Authentication**: Eliminated external identity provider dependencies (Google/GitHub OAuth).
    - **Passkeys (WebAuthn)**: Native support for biometrics and hardware keys.
    - **CLI Magic Links**: Bootstrap admin access directly from the terminal via `./scripts/sovereign-login.sh`.
- **Multi-Project Support**: The portal can now manage an unlimited number of projects. Each project has its own SCM settings, deployment targets, and LLM role configurations.
- **Next.js 14 Portal UI**: A completely redesigned command center with:
    - Real-time workflow status and activity logs.
    - Interactive "Planner" chat for defining task implementation details.
    - System health dashboard showing Temporal, Redis, and Worker status.
- **Declarative Deployment**: Support for `ai-swarm.deploy.yaml`. Define project-specific build and deploy commands directly in your source code.
- **Automated Setup Wizard**: New `./setup.sh` handles EVERYTHING: reverse proxy selection (Caddy/Nginx/Traefik), SSH key generation, environment variables, and admin account creation.
- **LLM Role Specialization**: Mix and match models:
    - Use `gemini-2.5-pro` for broad repository planning.
    - Use Claude Code for high-precision implementation.
    - Assign specific roles to workers via the System Settings.
- **Worker Scaling CLI**: New `./scale-workers.sh` script to dynamically scale from 1 to 8 workers without editing compose files manually.
- **Self-Healing Infrastructure**: Background workflows that detect "degraded" workers and attempt autonomous remediation and alerting.

### Infrastructure & Security
- **SSH Deployment Mode**: Automated generation and rotation of deployment keys.
- **Docker Compose Overlays**: Modular proxy support (local, caddy, nginx, traefik).
- **Z.ai Integration**: Direct support for Claude via Z.ai API keys with automated configuration syncing across workers.
- **Redis Heartbeats**: Real-time worker health monitoring replacing stale database state.

### Fixed
- GitHub PR creation logic to correctly set remote origin metadata.
- Claude Code session syncing across worker containers.
- Passkey registration compatibility with SimpleWebAuthn v11.

---

## [2.1.0] - 2026-01-02
- Initial public release anchor.
- Basic multi-agent implementation (Planner, Coder, Reviewer).
- Simple SSH-based deployment.
- GitLab/GitHub integration basics.
