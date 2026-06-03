# Default production image: lean data-plane only (no CUDA, Solana, ZK, or gRPC blockchain).
# For GPU ML routing use Dockerfile.ml; for local dev use Dockerfile.dev.
FROM rust:1.94-bookworm AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl \
    git \
    pkg-config \
    libssl-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
RUN mkdir -p src benches \
    && printf 'fn main() {}\n' > src/main.rs \
    && printf 'fn main() {}\n' > benches/registry_bench.rs \
    && printf 'fn main() {}\n' > benches/hotpath_bench.rs \
    && printf 'fn main() {}\n' > benches/transport_bench.rs

ENV CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse \
    CARGO_HTTP_MULTIPLEXING=false \
    CARGO_NET_RETRY=20 \
    CARGO_HTTP_TIMEOUT=600

RUN cargo fetch --locked || cargo fetch --locked || cargo fetch --locked

COPY build.rs ./
COPY proto ./proto
COPY src ./src
COPY benches ./benches

# P5: set ENABLE_OTEL=1 at build time to compile OTLP export (runtime still needs OTEL_EXPORTER_OTLP_ENDPOINT).
# P4: set ENABLE_QUIC=1 to compile Quinn provider tunnel + HTTP/3 ingress.
ARG ENABLE_OTEL=0
ARG ENABLE_QUIC=0
RUN if [ "$ENABLE_OTEL" = "1" ] && [ "$ENABLE_QUIC" = "1" ]; then \
      cargo build --release --locked --features otel,quic; \
    elif [ "$ENABLE_OTEL" = "1" ]; then \
      cargo build --release --locked --features otel; \
    elif [ "$ENABLE_QUIC" = "1" ]; then \
      cargo build --release --locked --features quic; \
    else \
      cargo build --release --locked; \
    fi

FROM debian:bookworm-slim

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

RUN echo "0 3 * * 0 /app/scripts/update_geoip.sh >> /var/log/geoip_update.log 2>&1" \
    | crontab -

ENV RUST_LOG=info \
    HOST=0.0.0.0 \
    PORT=8090 \
    METRICS_PORT=9090 \
    TUNNEL_PORT=3128 \
    REGION=default \
    GEO_DENY_LIST="" \
    GEO_ALLOW_LIST="" \
    GEOIP_DB_PATH="" \
    PROXY_CONNECT_TIMEOUT_SECS=10 \
    PROXY_IDLE_TIMEOUT_SECS=60 \
    RPC_REQUEST_TIMEOUT_SECS=15

EXPOSE 3128 8090 9090

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8090/health || exit 1

CMD ["sh", "-c", "cron && edge-gateway"]
