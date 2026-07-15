#!/usr/bin/env bash
# Bootstrap a fresh Ubuntu 22.04 GCE VM for ProxyHubb Phase A testnet.
# Run as root or with sudo on the VM after SSH login.
#
# Usage:
#   curl -fsSL ... | bash   # or clone repo and: sudo ./scripts/gcp-testnet-vm-setup.sh

set -euo pipefail

if [[ "${EUID:-}" -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw fail2ban

# Docker Engine + Compose plugin (official)
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# Deploy user (optional)
DEPLOY_USER="${DEPLOY_USER:-proxyhubb}"
if ! id "$DEPLOY_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$DEPLOY_USER"
  usermod -aG docker "$DEPLOY_USER"
fi

# UFW — adjust SSH source if not using IAP (restrict 22 to your IP in production)
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP ACME'
ufw allow 443/tcp comment 'HTTPS app+api'
ufw allow 8090/tcp comment 'Buyer CONNECT'
ufw allow 3128/tcp comment 'Provider tunnel TCP'
ufw allow 3128/udp comment 'Provider tunnel QUIC'
ufw --force enable

systemctl enable fail2ban
systemctl restart fail2ban || true

echo ""
echo "VM bootstrap complete."
echo "Next:"
echo "  1. Clone repo to /opt/proxyhubb (or home dir)"
echo "  2. cp config/gcp-testnet.env.example .env && fill hostnames + Solana"
echo "  3. ./scripts/gcp-testnet-generate-secrets.sh >> .env.secrets && merge secrets"
echo "  4. Place oracle-keypair.json in repo root (chmod 600)"
echo "  5. Install Caddy — see docs/GCP_TESTNET_PHASE_A.md"
echo "  6. docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml up -d --build"
