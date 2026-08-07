# GCP Testnet Phase A

Live path: **Compose on one GCE VM** (`proxyhubb-testnet`), not Kubernetes.

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.testnet.yml \
  -f docker-compose.gcp-testnet.yml \
  up -d
```

Env template: `config/gcp-testnet.env.example`  
Caddy: `config/gcp/Caddyfile.example`  
**HA lite / recovery:** [ops/GCP_HA_LITE.md](ops/GCP_HA_LITE.md)

Provision / backup helpers live under `scripts/gcp-*.sh` (see README live-stack table).
