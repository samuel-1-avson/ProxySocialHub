FROM nvidia/cuda:12.4.1-devel-ubuntu22.04 AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl \
    git \
    pkg-config \
    libssl-dev \
    protobuf-compiler \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Copy manifest and source
COPY Cargo.toml Cargo.lock ./
COPY build.rs ./
COPY proto ./proto
COPY src ./src
# Bench sources declared in Cargo.toml — must be present for manifest parsing.
COPY benches ./benches

# Build in release mode with ONNX (ml) and ZK features enabled.
RUN cargo build --release --features ml

# ---------------------------------------------------------------------------
# Runtime image — NVIDIA CUDA Base for GPU-acceleration (Phase 9)
# ---------------------------------------------------------------------------
FROM nvidia/cuda:12.4.1-base-ubuntu22.04

RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/edge-gateway /usr/local/bin/

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

CMD ["edge-gateway"]
