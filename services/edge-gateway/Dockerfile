FROM rust:1.84-alpine AS builder

WORKDIR /app
RUN apk add --no-cache musl-dev protoc protobuf-dev openssl-dev openssl-libs-static pkgconfig

# Copy entire workspace (optimization possible later)
COPY . .

WORKDIR /app/services/edge-gateway
RUN cargo build --release

FROM alpine:latest
RUN apk --no-cache add curl
COPY --from=builder /app/services/edge-gateway/target/release/edge-gateway /usr/local/bin/
CMD ["edge-gateway"]
