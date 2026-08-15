# GCP Testnet Phase A

**Status (2026-08-09):** Phase A topology **formally accepted** for limited-cohort Solana **devnet** invites.  
Evidence: [`ops/evidence/PHASE_A_SPOF_ACCEPTANCE_20260809T140300Z.md`](ops/evidence/PHASE_A_SPOF_ACCEPTANCE_20260809T140300Z.md) → `PHASE_A_SPOF_ACCEPTED`.

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

## Honesty bounds

- **In scope:** best-effort Testnet; backups + on-VM Redis process failover; UI/Help disclose single-server ops.
- **Out of scope until Phase B:** regional HA, 99.9% SLO, always-on large public, mainnet capital claims.
- **Exit Phase A only when** multi-host compute, managed Postgres + cross-host Redis, and worker leader election are live (see acceptance evidence).
