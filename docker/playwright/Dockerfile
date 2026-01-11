# AI Swarm Playwright - Browser Testing Service
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /tests

# Create test directory structure
RUN mkdir -p /tests/specs

# Initialize npm and install playwright
RUN npm init -y && npm install playwright@1.40.0

# Keep container running (tests invoked via docker exec)
CMD ["tail", "-f", "/dev/null"]
