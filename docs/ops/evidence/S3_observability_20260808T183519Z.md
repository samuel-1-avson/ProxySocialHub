# S3 Observability (platform-native alerts) — 20260808T183519Z

| Check | Result |
|-------|--------|
| Verdict | **PASS** |
| Prometheus ready | `200` |
| Grafana health | `200` |
| Slack cleared | `true` |
| PagerDuty cleared | `true` |
| Internal webhook probe | HTTP `200` |
| Recent alerts API | HTTP `200` |
| ops_alerts rows | `5` |

## Model
- Durable journal: `ops_alerts`
- Bus: NATS subject `proxy.ops.v1.alerts` (JetStream OPS stream)
- Grafana → `POST /internal/alerts/webhook` (already in contact-points.yml)
- **No Slack / PagerDuty** (centralized SaaS removed from S3 DoD)

## control-api alert log
```
control-api-1  | [90m2026-08-08T18:38:37Z[0m [32mINF[0m [1mapp/internal/alerts/channels.go:175[0m[36m >[0m [1mAlert channels ready (durable ops_alerts journal + NATS; no Slack/PagerDuty)[0m [36mcomponent=[0mapi [36moptional_webhook=[0mfalse
```
