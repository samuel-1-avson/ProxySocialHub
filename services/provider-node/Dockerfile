# Production image for the ProxyHubb provider node.
FROM rust:1.94-bookworm AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ca-certificates \
    pkg-config \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./

RUN mkdir -p src && printf 'fn main() {}\n' > src/main.rs

ENV CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse \
    CARGO_HTTP_MULTIPLEXING=false \
    CARGO_NET_RETRY=20 \
    CARGO_HTTP_TIMEOUT=600

RUN cargo fetch --locked

COPY src ./src

ARG ENABLE_QUIC=0
RUN if [ "$ENABLE_QUIC" = "1" ]; then \
      cargo build --release --locked --features quic; \
    else \
      cargo build --release --locked; \
    fi

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/provider-node /usr/local/bin/provider-node

ENV RUST_LOG=info

EXPOSE 9090

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:9090/stats || exit 1

ENTRYPOINT ["provider-node"]
