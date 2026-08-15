# syntax=docker/dockerfile:1
FROM rust:1.86-bookworm AS builder
WORKDIR /app
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/proxyhubb-groth16-prover /usr/local/bin/proxyhubb-groth16-prover
ENV PORT=8096
EXPOSE 8096
CMD ["proxyhubb-groth16-prover"]
