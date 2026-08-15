# S3 Observability + Alert Wiring — 20260808T130025Z

| Check | Result |
|-------|--------|
| Verdict | **PARTIAL_NO_EXTERNAL_CHANNEL** |
| Prometheus ready | `200` (127.0.0.1:9091) |
| Grafana health | `200` (127.0.0.1:3001) |
| Slack wired | `false` (missing) |
| PagerDuty wired | `false` (missing) |
| control-api alert init | see below |
| Internal webhook probe | HTTP `200` |
| nats_* gauge series present | `4` |

## Prometheus targets
```
control-api:up
edge-gateway:up
prometheus:up
redis:up
```

## control-api alert log
```
control-api-1  | [90m2026-08-08T13:03:46Z[0m [33mWRN[0m [1mapp/internal/alerts/channels.go:197[0m[36m >[0m [1mNo alert channels configured — set SLACK_ALERT_WEBHOOK_URL or ALERT_ADMIN_EMAILS[0m [36mcomponent=[0mapi
```

## Operator follow-ups
- Create Slack incoming webhook and either:
  - `gcloud secrets create proxyhubb-slack-alert-webhook --data-file=-` then re-run this script, or
  - `SLACK_ALERT_WEBHOOK_URL=... sudo -E bash scripts/gcp-s3-enable-observability.sh`
- Optional: store PagerDuty Events v2 routing key as secret `proxyhubb-pagerduty-routing-key`
- In Grafana → Alerting → Contact points → set Authorization: Bearer <INTERNAL_ALERT_WEBHOOK_TOKEN> on webhook
- COMPOSE_PROFILES=observability is now in `.env`
