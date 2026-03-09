#!/bin/bash
# Docker Security Hardening Script
# Run this to generate secure Docker configurations

set -e

echo "🐳 Docker Security Hardening"
echo "============================"

# Create secure Dockerfiles directory
mkdir -p docker/secure

# Generate hardened Control API Dockerfile
cat > docker/secure/Dockerfile.control-api << 'EOF'
# Build stage
FROM golang:1.22-alpine AS builder

# Security: Don't run as root in build
RUN adduser -D -g '' appuser

WORKDIR /app

# Install dependencies first (better layer caching)
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# Copy source
COPY . .

# Build with security flags
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags='-w -s -extldflags "-static"' \
    -a -installsuffix cgo \
    -o server \
    main.go

# Runtime stage
FROM scratch

# Import from builder
COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /app/server /server

# Use non-root user
USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD ["/server", "-health-check"] || exit 1

# Run
ENTRYPOINT ["/server"]
EOF

echo "✅ Created secure Dockerfile.control-api"

# Generate hardened Edge Gateway Dockerfile
cat > docker/secure/Dockerfile.edge-gateway << 'EOF'
# Build stage
FROM rust:1.75-alpine AS builder

RUN adduser -D -g '' appuser

WORKDIR /app

# Install musl for static linking
RUN apk add --no-cache musl-dev openssl-dev

# Build
COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release --target x86_64-unknown-linux-musl

# Runtime stage
FROM scratch

COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /app/target/x86_64-unknown-linux-musl/release/edge-gateway /edge-gateway

USER appuser

EXPOSE 3128 8090

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD ["/edge-gateway", "--health-check"] || exit 1

ENTRYPOINT ["/edge-gateway"]
EOF

echo "✅ Created secure Dockerfile.edge-gateway"

# Generate docker-compose.security.yml
cat > docker/secure/docker-compose.security.yml << 'EOF'
version: '3.8'

# This is a hardened production configuration
# Use instead of default docker-compose.yml

services:
  control-api:
    build:
      context: ../../services/control-api
      dockerfile: ../../docker/secure/Dockerfile.control-api
    read_only: true
    user: "1000:1000"
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    tmpfs:
      - /tmp:noexec,nosuid,size=100m
    environment:
      - SECRET_MANAGER=${SECRET_MANAGER:-env}
    secrets:
      - jwt_secret
      - db_password
      - encryption_key
    networks:
      - backend
    deploy:
      replicas: 2
      update_config:
        parallelism: 1
        delay: 10s
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3

  edge-gateway:
    build:
      context: ../../services/edge-gateway
      dockerfile: ../../docker/secure/Dockerfile.edge-gateway
    read_only: true
    user: "1000:1000"
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    secrets:
      - tls_key
      - provider_private_key
    networks:
      - backend
      - frontend
    deploy:
      replicas: 3

  redis:
    image: redis:7-alpine
    command: >
      redis-server
      --requirepass /run/secrets/redis_password
      --appendonly yes
      --protected-mode yes
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
      --tcp-backlog 511
      --timeout 0
      --tcp-keepalive 300
    sysctls:
      - net.core.somaxconn=65535
    secrets:
      - redis_password
    volumes:
      - redis_data:/data
    networks:
      - backend

networks:
  backend:
    internal: true
  frontend:
    driver: bridge

volumes:
  redis_data:
    driver: local

secrets:
  jwt_secret:
    external: true
  db_password:
    external: true
  encryption_key:
    external: true
  redis_password:
    external: true
  tls_key:
    external: true
  provider_private_key:
    external: true
EOF

echo "✅ Created docker-compose.security.yml"

# Create Docker secrets helper script
cat > docker/secure/create-secrets.sh << 'EOF'
#!/bin/bash
# Create Docker secrets for production deployment

set -e

echo "Creating Docker secrets..."

# Check if running in swarm mode
if ! docker info --format '{{.Swarm.LocalNodeState}}' | grep -q "active"; then
    echo "⚠️  Docker Swarm not active. Initializing..."
    docker swarm init || true
fi

# Create secrets from environment variables
create_secret() {
    local name=$1
    local value=$2
    
    # Remove existing secret if exists
    docker secret rm "$name" 2>/dev/null || true
    
    # Create new secret
    echo -n "$value" | docker secret create "$name" -
    echo "  ✓ Created secret: $name"
}

# Load from .env if exists
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Create required secrets
create_secret "jwt_secret" "${JWT_SECRET}"
create_secret "db_password" "${POSTGRES_PASSWORD}"
create_secret "encryption_key" "${ENCRYPTION_KEY}"
create_secret "redis_password" "${REDIS_PASSWORD}"

# Optional secrets
if [ -n "$TLS_KEY" ]; then
    create_secret "tls_key" "$TLS_KEY"
fi

if [ -n "$PROVIDER_PRIVATE_KEY" ]; then
    create_secret "provider_private_key" "$PROVIDER_PRIVATE_KEY"
fi

echo ""
echo "✅ All secrets created successfully"
echo ""
echo "Deploy with:"
echo "  docker stack deploy -c docker-compose.security.yml proxyhubb"
EOF

chmod +x docker/secure/create-secrets.sh

echo "✅ Created create-secrets.sh"

# Summary
echo ""
echo "================================"
echo "Docker Security Files Created:"
echo "================================"
echo ""
ls -la docker/secure/
echo ""
echo "Usage:"
echo "  1. Review the generated files"
echo "  2. Run: ./docker/secure/create-secrets.sh"
echo "  3. Deploy: docker stack deploy -c docker/secure/docker-compose.security.yml proxyhubb"
