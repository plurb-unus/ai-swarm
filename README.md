# AI Swarm

> Autonomous development orchestration powered by LLMs and Temporal.io

AI Swarm is a complete automation platform that uses Large Language Models to handle the entire software development lifecycle—from planning and coding to review and deployment.

## What Makes AI Swarm Different

Unlike simple AI coding assistants, AI Swarm is an **autonomous orchestration system**:

- **Plans** implementation details based on your task description
- **Writes** code in isolated Git branches (worktrees)
- **Reviews** its own work against the plan
- **Builds and tests** the changes automatically
- **Deploys** to production with automatic rollback on failure

## Architecture

![AI Swarm Architecture](/images/docs/architecture.png)

AI Swarm follows a decoupled, event-driven architecture designed for maximum reliability and scalability:

1.  **Portal (Next.js)**: The command center where users chat with agents, define project context, and monitor workflow progress in real-time.
2.  **Temporal.io Orchestration**: The "brain" of the system. It manages state persistence, timeouts, and retries, ensuring that even if a server crashes, the task resumes exactly where it left off.
3.  **Stateless Workers**: Distributed compute units that execute the actual work (planning, coding, testing). They are ephemeral and scale horizontally.
4.  **LLM Providers**: Pluggable support for Gemini and Claude. Different models can be assigned to specialized roles like "Lead Architect" or "QA Tester."

## Workflow Lifecycle

![Workflow Lifecycle](/images/docs/lifecycle.png)

Every task submitted to the Swarm undergoes a rigorous, multi-stage lifecycle to ensure code quality and system stability:

1.  **Task Definition**: Requirements are gathered via the Web UI or a connected AI IDE.
2.  **Autonomous Planning**: The Primary Agent analyzes the codebase context (`.aicontext`, `claude.md`) and decomposes the task into a series of actionable steps.
3.  **Implementation**: Workers create isolated Git worktrees and implement changes step-by-step.
4.  **Self-Review**: A specialized Reviewer Agent analyzes the diff against both the plan and the project's coding standards.
5.  **Verification**: The Swarm executes automated builds, linting, and unit tests within the project's original environment.
6.  **Autonomous Deployment**: Once verified, the swarm initiates a rollout (e.g., via Docker Compose or SSH) and monitors for health regressions.

## Key Features

- **Multi-LLM Strategy**: Assign different models (Gemini-1.5-Pro for planning, Claude-3.5-Sonnet for implementation) to optimize for cost and capability.
- **Fail-Safe Orchestration**: Leveraging Temporal.io for durable workflows that handle infrastructure failures, API rate limits, and network partitions gracefully.
- **Sovereign Security**: Built-in WebAuthn (Passkeys) and CLI magic links. No external identity provider dependencies.
- **Git-Aware Workers**: Automatic branch management, PR creation, and worktree isolation—never pollute your main branch with intermediate states.
- **Context-Aware Discovery**: Deep integration with project documentation, including `.aicontext`, `claude.md`, and recursive repository analysis.
- **Autonomous Recovery**: If a deployment fails or a build breaks, the swarm automatically generates a "fix task" to investigate and resolve the regression.

## Support the Swarm

AI Swarm is 100% open-source and community-supported. If you find it useful, please consider supporting its development:

<!-- GitHub Sponsors badge will be added after approval -->
<!-- [![Sponsor](https://img.shields.io/badge/sponsor-GitHub%20Sponsors-ea4aaa?logo=github)](https://github.com/sponsors/ai-swarm-dev) -->

- **[Donate via Polar.sh](https://buy.polar.sh/polar_cl_PCnKCrTtcxLyeM4UIDHp3C6t2P9KCZoez3uB235qM40)**: One-time or recurring contributions.
- **[Subscribe Monthly](https://buy.polar.sh/polar_cl_owCRrrREMr2UcAGVTDCWSuxXxaOPAtOW0MrqX3qk6Yt)**: Help sustain the project.
- **Star the Repository**: Help others discover the project.
- **[Contact](https://ai-swarm.dev)**: Reach out for feedback or questions via our website.

## Submit from Any AI Tool

AI Swarm isn't just a chat UI—it's an **orchestration backend** that any AI tool can leverage.

**Two ways to submit tasks:**

| Method | Best For |
|--------|----------|
| **Chat & Plan UI** | Mobile, tablet, or when away from your dev machine |
| **Direct Submission** | Your AI IDE (Cursor, Windsurf, Claude CLI, Antigravity) |

### Direct Submission

Refer to the full [IDE Integration Guide](./IDE_INTEGRATION.md) to add AI Swarm submission to your favorite AI tool:

```bash
# Example: Submit a task from any terminal with SSH access
ssh your-server "docker exec temporal tctl --namespace ai-swarm \
  workflow start --taskqueue ai-swarm-tasks --workflow_type developFeature \
  --workflow_id my-task --input_file /tmp/task.json"
```

See the full prompt and JSON format in the [IDE Integration Guide](./IDE_INTEGRATION.md).

## Prerequisites

- **Linux server** (Ubuntu 22.04+ recommended) or macOS/WSL2 for local development
- **Docker & Docker Compose** v2
- **LLM access**: Claude Pro/Max or Z.ai API key, and/or Gemini CLI
- **Domain name** (optional, for production with SSL)

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/ai-swarm-dev/ai-swarm.git
cd ai-swarm

# 2. Run the setup wizard
./setup.sh

# 3. Start AI Swarm
./start.sh
```

The setup wizard will:
1. Select your reverse proxy configuration
2. Generate SSH deployment key (displayed for you to copy)
3. Configure environment variables
4. Create your admin account with a magic link

### Proxy Options

| Mode | Command | Use Case |
|------|---------|----------|
| local | `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d` | Evaluation, development |
| caddy | `docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d` | Production (auto-HTTPS) |
| nginx | `docker compose -f docker-compose.yml -f docker-compose.nginx.yml up -d` | Production (manual certs) |
| traefik | `docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d` | Existing Traefik users |

## Deployment Setup

AI Swarm workers deploy changes to servers via SSH. During `./setup.sh`, a dedicated deploy key is generated.

### Adding Deployment Targets

1. **Copy the public key** displayed during setup to each server:
   ```bash
   # On the remote server:
   echo 'ssh-ed25519 AAAA... ai-swarm-deploy' >> ~/.ssh/authorized_keys
   ```

2. **Add the server to known_hosts** (first connection):
   ```bash
   ssh-keyscan myserver.com >> ~/.ssh/known_hosts
   ```

3. **Configure in Portal** (Settings > Projects > Deployment):
   - SSH Host: `myserver.com`
   - SSH User: `ubuntu`
   - Deploy Dir: `/home/ubuntu/apps/myproject`

> **Note:** For same-host deployment (workers SSH to `host.docker.internal`), also add the public key to your local `~/.ssh/authorized_keys`.

## Documentation

Full documentation is available at `/help` after deployment:

- **Overview**: Architecture and key concepts
- **Prerequisites**: What you need before deploying
- **Setup Guide**: Step-by-step installation
- **User Guide**: How to use AI Swarm day-to-day
- **Reference**: Technical details and configuration
- **Troubleshooting**: Common issues and solutions

## Tech Stack

| Component | Technology |
|-----------|------------|
| Orchestration | Temporal.io |
| Portal | Next.js 14 |
| Workers | Node.js + Docker |
| Database | PostgreSQL |
| Cache | Redis |
| LLMs | Claude, Gemini |

## Project Structure

```
ai-swarm/
├── apps/
│   └── portal/          # Next.js dashboard + chat
├── packages/
│   ├── shared/          # Types, services, logger
│   ├── workflows/       # Temporal workflows & activities
│   └── worker/          # Worker entry point
├── docker/              # Docker configurations
├── setup.sh             # Bootstrap script
├── auth-gemini.sh       # Gemini authentication helper
├── auth-claude.sh       # Claude authentication helper
└── teardown.sh          # Clean removal
```

## Scripts

| Script | Purpose |
|--------|---------|
| `./setup.sh` | Setup wizard and configuration |
| `./start.sh` | Start AI Swarm (generated by setup) |
| `./stop.sh` | Stop AI Swarm (generated by setup) |
| `./scale-workers.sh` | Change worker count (1-8) |
| `./auth-gemini.sh` | Authenticate workers with Gemini |
| `./auth-claude.sh` | Authenticate workers with Claude |
| `./teardown.sh` | Remove all containers and data |

## License

Apache 2.0
