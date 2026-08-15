# 16 — DevOps, Observability & Deployment Audit

## 1. Deployment Topology

| Path | Verdict |
|------|---------|
| `docker-compose.yml` (base) | Solid: healthchecks, `service_completed_successfully` migrate gating, pinned infra tags, named volumes, no privileged/host-net. **Fixed this audit:** Postgres/Redis/NATS ports loopback-bound; dev bypasses default off |
| `docker-compose.prod.yml` | Core OK (APP_ENV=production, enforce signatures, required URLs); **fixed:** Prometheus alert-rules mount; remaining: `:latest` tags, no zk-prover |
| `docker-compose.gcp-testnet.yml` | Good hardening overlay (localhost binds, clears DB/Redis ports) |
| `docker-compose.gcp-images.yml` | GHCR `samuel-1-avson/*` — mismatches other paths (OPS-02) |
| `infra/docker-compose/docker-compose.yml` | **Legacy footgun:** hardcoded `POSTGRES_PASSWORD: password`, public 5432/6379, no healthchecks — remove (OPS-05) |
| Dockerfiles | Multi-stage, non-root control-api; web bakes localhost WS default (FE-02); `Dockerfile.simple` swallows build errors (FE-13) |
| `infra/k8s/*` | Mixed maturity: probes/HPA/PDB/NetworkPolicy exist; **broken:** missing `overlays/{staging,production}` referenced by deploy.yml (OPS-01); pgbouncer empty-password MD5 (SEC-04); Redis no auth/protected-mode no (SEC-05); HAProxy stats admin (SEC-06); `:latest` images |

## 2. CI/CD

| Workflow | Purpose | Assessment |
|----------|---------|------------|
| `proxyhubb-ci.yml` | PR/push CI | Strong: secrets gate, Gitleaks, path-filtered builds/tests, migration smoke |
| `security.yml` | vuln scanning | Broad; Trivy non-blocking (tighten) |
| `deploy.yml` | tag → GHCR → EKS kustomize | **Broken:** overlays missing; registry mismatch (OPS-01/02) |
| `uptime-probe.yml` | 15-min health probe | OK |
| `qa-live-testnet.yml` | 30-min live smoke | OK (uses `QA_LIVE_JWT`) |
| `cli-dist-release.yml` | multi-OS CLI releases | OK |
| `sdk-publish.yml` | npm/PyPI/Go publish | OK |

## 3. Observability

| Layer | State |
|-------|-------|
| Prometheus scrapes | control-api, edge-gateway, redis-exporter (`infra/prometheus.yml`) |
| Alert rules | EdgeGatewayDown / NoHealthyProviders / HighAuthFailureRate / AdmissionRejections; OrderStatusIllegalTransitions — **now mounted in prod compose (fix)** |
| Grafana | dashboards (overview, edge RED) + alert rules/contact points/policies provisioning |
| OTEL | dev collector exports to **debug only** (OPS-06); no durable trace backend |
| Log correlation | `X-Request-ID` middleware; events lack trace IDs |
| Health endpoints | all core services |
| Missing | NATS lag metrics (EV-07), financial-inconsistency alerts beyond recon history, metering-delay alerts |

## 4. Backup / DR

`gcp-postgres-backup.sh` (pg_dump -Fc + sha256 + optional GCS), cron installer, verify script, restore-drill script — production-grade tooling for the GCP VM path; effectiveness depends on the installer having run on the live VM (not verifiable from repo). No cross-region DR documented.

## 5. Deploy Scripts

Root `deploy-financial-p0-*.sh`, `scripts/gcp-compose-pull-deploy.sh`, `scripts/gcp-testnet-provision*.sh` — no embedded credentials observed; mostly idempotent; targeted at the GCP compose path (which works), reinforcing that the k8s/EKS path is the broken one.

## 6. Findings

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| OPS-01 | deploy.yml → missing kustomize overlays | Critical | Open |
| OPS-02 | GHCR owner mismatch across deploy paths (`proxyhubb` vs `samuel-1-avson`) | High | Open |
| OPS-03 | `:latest` tags in prod compose/k8s | Medium | Open |
| OPS-04 | Prod Prometheus missing alerts mount | Medium | **Fixed** |
| OPS-05 | Legacy infra compose (hardcoded password, public ports) | Medium | Open (remove) |
| OPS-06 | OTEL debug-only exporter | Low | Open |
| OPS-07 | Referenced `docs/GCP_TESTNET_PHASE_A.md` missing | Low | Open |
| OPS-08 | Load tests target Solana RPC, not product API/gateway | Low | Open |
| SEC-01/02/07 | compose exposure/defaults | High/Med | **Fixed** |
| SEC-04/05/06 | pgbouncer/Redis/HAProxy k8s weaknesses | High/High/Med | Open |
