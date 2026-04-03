FROM rust:1.94-bookworm AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl \
    git \
    pkg-config \
    libssl-dev \
    protobuf-compiler \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy manifest and source
COPY Cargo.toml Cargo.lock ./
COPY build.rs ./
COPY proto ./proto
COPY src ./src
# Bench sources declared in Cargo.toml — must be present for manifest parsing.
COPY benches ./benches

# Improve resilience against transient crates.io and CDN failures during image builds.
ENV CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse \
    CARGO_HTTP_MULTIPLEXING=false \
    CARGO_NET_RETRY=20 \
    CARGO_HTTP_TIMEOUT=600

RUN cargo fetch --locked || cargo fetch --locked || cargo fetch --locked

# Build in release mode with ONNX (ml) and ZK features enabled.
RUN cargo build --release --locked --features ml

# ---------------------------------------------------------------------------
# Runtime image — NVIDIA CUDA Base for GPU-acceleration (Phase 9)
# ---------------------------------------------------------------------------
FROM nvidia/cuda:12.4.1-base-ubuntu22.04

RUN apt-get update && apt-get install -y \
    curl \
    wget \
    ca-certificates \
    libssl3 \
    cron \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/edge-gateway /usr/local/bin/
COPY scripts/update_geoip.sh /app/scripts/update_geoip.sh
RUN chmod +x /app/scripts/update_geoip.sh

# Weekly GeoIP update: every Sunday at 03:00 UTC
RUN echo "0 3 * * 0 /app/scripts/update_geoip.sh >> /var/log/geoip_update.log 2>&1" \
    | crontab -

# Runtime environment defaults (override via docker-compose or -e flags)
ENV RUST_LOG=info \
    HOST=0.0.0.0 \
    PORT=8090 \
    TUNNEL_PORT=3128 \
    REGION=default \
    GEO_DENY_LIST="" \
    GEO_ALLOW_LIST="" \
    GEOIP_DB_PATH="" \
    PROXY_CONNECT_TIMEOUT_SECS=10 \
    PROXY_IDLE_TIMEOUT_SECS=60 \
    RPC_REQUEST_TIMEOUT_SECS=15

EXPOSE 3128 8090

# Health check using the HTTP health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8090/health || exit 1

# Start cron in background then run the gateway
CMD ["sh", "-c", "cron && edge-gateway"]
