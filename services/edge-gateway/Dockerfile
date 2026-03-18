FROM rust:1.85-alpine AS builder

WORKDIR /app

# Build dependencies: musl, OpenSSL (static), and C toolchain for any sys crates.
# lzma-sys (pulled in by ort transitive deps) needs xz-dev at compile time.
# Separate update from add so a CDN hiccup on index fetch doesn't silently
# leave an empty package database and fail all installs with "no such package".
RUN apk update && apk add --no-cache \
    musl-dev \
    openssl-dev \
    openssl-libs-static \
    pkgconfig \
    git \
    make \
    gcc \
    g++ \
    xz-dev \
    protobuf-dev

# Copy manifest and source
COPY Cargo.toml Cargo.lock ./
COPY build.rs ./
COPY proto ./proto
COPY src ./src
# Bench sources declared in Cargo.toml — must be present for manifest parsing.
COPY benches ./benches

# Build in release mode without the optional ONNX feature so the image stays
# small and does not require a pre-trained model file at runtime.
# Add `--features ml` here only if you have an ONNX model and the ort runtime
# libraries available.
RUN cargo build --release --no-default-features

# ---------------------------------------------------------------------------
# Runtime image — minimal Alpine
# ---------------------------------------------------------------------------
FROM alpine:3.20

RUN apk --no-cache add curl ca-certificates netcat-openbsd

COPY --from=builder /app/target/release/edge-gateway /usr/local/bin/

# Runtime environment defaults (override via docker-compose or -e flags)
ENV RUST_LOG=info \
    HOST=0.0.0.0 \
    PORT=8090 \
    TUNNEL_PORT=3128 \
    REGION=default \
    GEO_DENY_LIST="" \
    GEO_ALLOW_LIST="" \
    GEOIP_DB_PATH=""

EXPOSE 3128 8090

# Health check using the HTTP health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8090/health || exit 1

CMD ["edge-gateway"]
