FROM rust:1.86-bookworm AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/proxyhubb-zk

WORKDIR /app
COPY --from=builder /app/target/release/proxyhubb-zk-prover /usr/local/bin/proxyhubb-zk-prover

EXPOSE 8095
ENV PORT=8095
ENV RUST_LOG=info
ENV ZK_PROVER_KEYS_DIR=/var/lib/proxyhubb-zk

VOLUME ["/var/lib/proxyhubb-zk"]

CMD ["proxyhubb-zk-prover"]
