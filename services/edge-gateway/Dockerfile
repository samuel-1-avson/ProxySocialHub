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
RUN apk --no-cache add curl ca-certificates
COPY --from=builder /app/target/release/edge-gateway /usr/local/bin/
EXPOSE 3128 8090
CMD ["edge-gateway"]
