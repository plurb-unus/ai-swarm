# AI Swarm Builder - Persistent Build Environment
# Tools installed by AI persist via tools-data volume
FROM alpine:3.19

# Install core tools (without Go from apk - we'll install newer version)
RUN apk add --no-cache \
    bash \
    git \
    curl \
    sudo \
    shadow \
    build-base \
    python3 \
    py3-pip \
    nodejs \
    npm

# Install Go 1.24+ (required by AI Swarm)
ARG GO_VERSION=1.24.3
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-$(uname -m | sed 's/aarch64/arm64/;s/x86_64/amd64/').tar.gz" \
    | tar -C /usr/local -xzf - && \
    ln -s /usr/local/go/bin/go /usr/bin/go && \
    ln -s /usr/local/go/bin/gofmt /usr/bin/gofmt

# Create directories for persistent tools
RUN mkdir -p /opt/ai-swarm/tools/bin && \
    mkdir -p /opt/ai-swarm/cache/go-build && \
    mkdir -p /opt/ai-swarm/cache/go-mod && \
    mkdir -p /opt/ai-swarm/cache/npm && \
    mkdir -p /opt/ai-swarm/cache/pip

# Create worker user with sudo access (for package installs)
RUN adduser -D -u 1001 worker && \
    echo "worker ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/worker && \
    chown -R worker:worker /opt/ai-swarm

# Configure PATH to include persistent tools and Go
ENV PATH="/usr/local/go/bin:/opt/ai-swarm/tools/bin:${PATH}"

# Configure cache paths for various languages
ENV GOCACHE="/opt/ai-swarm/cache/go-build"
ENV GOMODCACHE="/opt/ai-swarm/cache/go-mod"
ENV npm_config_cache="/opt/ai-swarm/cache/npm"
ENV PIP_CACHE_DIR="/opt/ai-swarm/cache/pip"

WORKDIR /workspace
USER worker

# Keep container running (commands invoked via docker exec)
CMD ["tail", "-f", "/dev/null"]
