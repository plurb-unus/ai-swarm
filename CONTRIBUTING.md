# Contributing to AI Swarm

First off, thank you for considering contributing to AI Swarm! It's people like you that make AI Swarm such a great tool.

## Code of Conduct

By participating in this project, you are expected to uphold our Code of Conduct (standard Apache/Contributor Covenant).

## How Can I Contribute?

### Reporting Bugs

- **Check for existing issues**: Before opening a new issue, please search the tracker to see if the problem has already been reported.
- **Provide detail**: Include your OS, Docker version, and clear steps to reproduce the issue.
- **Logs are helpful**: Attach logs from `docker compose logs` if applicable.

### Suggesting Enhancements

- **Open an issue**: Describe the enhancement and why it would be useful.
- **Brainstorming**: We welcome ideas on how to make the orchestration more autonomous or support more LLM providers.

### Pull Requests

1.  **Fork the repo** and create your branch from `main`.
2.  **Install dependencies**: We use `pnpm`. Run `pnpm install` in the root.
3.  **Follow the structure**: 
    - `apps/portal`: Next.js frontend
    - `packages/workflows`: Temporal workflow and activity definitions
    - `packages/shared`: Core utilities and database services
4.  **Build order matters**: The monorepo must be built in this order:
    - `pnpm --filter @ai-swarm/shared build`
    - `pnpm --filter @ai-swarm/workflows build`
    - `pnpm --filter @ai-swarm/worker build`
    - `pnpm --filter @ai-swarm/portal build`
5.  **Test your changes**: Ensure you haven't broken existing flows. Run `pnpm test` if available, or manually verify by submitting a task through the portal.
6.  **Document everything**: If you add a feature, update the `.aicontext` files or the `/help` pages in the portal.
7.  **Submit a PR**: Provide a clear description of your changes.

## Development Environment Setup

1.  Clone your fork.
2.  Run `pnpm install`.
3.  Copy `.env.example` to `.env`.
4.  Run `./setup.sh` to initialize the development environment.
5.  Run `./start.sh` to launch the Docker containers.
6.  Access the portal at `http://localhost:3000`.

## License

By contributing, you agree that your contributions will be licensed under its Apache 2.0 License.
