FROM rust:1.84-alpine AS builder

WORKDIR /app
RUN apk add --no-cache musl-dev protoc protobuf-dev openssl-dev openssl-libs-static pkgconfig perl git make gcc g++

# Copy only what we need
COPY services/edge-gateway/Cargo.toml services/edge-gateway/Cargo.lock ./
COPY services/edge-gateway/build.rs ./
COPY services/edge-gateway/src ./src
COPY proto ./proto

# Build
RUN cargo build --release

FROM alpine:latest
RUN apk --no-cache add curl ca-certificates netcat-openbsd
COPY --from=builder /app/target/release/edge-gateway /usr/local/bin/
EXPOSE 3128 3000 4000

# Health check on the proxy port (3000) - TCP check since proxy doesn't have HTTP health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD nc -z 127.0.0.1 3000 2>/dev/null || exit 1

CMD ["edge-gateway"]
