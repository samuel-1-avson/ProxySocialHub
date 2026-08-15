#!/usr/bin/env bash
cd /opt/proxyhubb
sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml exec -T postgres psql -U proxyhubb -d proxyhubb -c '\d linked_wallets'
sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml exec -T postgres psql -U proxyhubb -d proxyhubb -c '\d wallets'