#!/usr/bin/env bash
# Generate a self-signed buyer TLS cert for Phase A (or bootstrap before LE certs).
# For production-like hostnames, prefer a real cert (Caddy / Let's Encrypt) and
# point BUYER_TLS_CERT_FILE / BUYER_TLS_KEY_FILE at those paths.
#
# Usage:
#   ./scripts/gcp-buyer-tls-selfsigned.sh [CN]
#   # writes certs/server.crt and certs/server.key

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
CERT_DIR="${CERT_DIR:-$PROJECT_DIR/certs}"
CN="${1:-proxy.proxyhubb.com}"

mkdir -p "$CERT_DIR"
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.crt" \
  -days 825 \
  -subj "/CN=${CN}" \
  -addext "subjectAltName=DNS:${CN},DNS:localhost,IP:127.0.0.1"

chmod 600 "$CERT_DIR/server.key"
chmod 644 "$CERT_DIR/server.crt"
echo "Wrote $CERT_DIR/server.crt and $CERT_DIR/server.key (CN=${CN})"
echo "GCP overlay defaults BUYER_TLS_ENABLE=true and mounts ./certs into edge-gateway."
