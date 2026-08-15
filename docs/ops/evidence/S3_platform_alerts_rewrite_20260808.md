# S3 rewrite — platform-native alerts (no Slack)

| Field | Value |
|-------|-------|
| Stamp | 2026-08-08 |
| Policy | Decentralized Testnet — **no SaaS Slack / PagerDuty** |
| Code | `services/control-api/internal/alerts/channels.go` |
| Migration | `000143_ops_alerts` |

## What changed
- Removed Slack webhook + PagerDuty Events API from alert delivery.
- Alerts now: structured log → durable `ops_alerts` → NATS `proxy.ops.v1.alerts` (JetStream `OPS` stream).
- Grafana already forwards to `POST /internal/alerts/webhook` (`infra/grafana/alerting/contact-points.yml`).
- Operators read history via `GET /internal/alerts/recent` (same internal token).
- Optional `ALERT_WEBHOOK_URL` for **self-hosted** receivers only (ntfy/Matrix/custom).

## Wave alignment
S3 DoD was “operator visibility”, not “use Slack”. This keeps Wave 1 on-report without SaaS centralization.
