FROM rust:1.84-alpine AS builder

WORKDIR /app
RUN apk add --no-cache musl-dev protoc protobuf-dev openssl-dev openssl-libs-static pkgconfig

# Copy only what we need
COPY Cargo.toml Cargo.lock ./
COPY build.rs ./
COPY src ./src

# Build
RUN cargo build --release

FROM alpine:latest
RUN apk --no-cache add curl ca-certificates
COPY --from=builder /app/target/release/edge-gateway /usr/local/bin/
EXPOSE 3128 8090
CMD ["edge-gateway"]
