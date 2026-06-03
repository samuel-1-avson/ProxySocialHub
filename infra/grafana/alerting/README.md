# Grafana alerting (edge-gateway)

Provisioned with the main stack (`./infra/grafana` → `/etc/grafana/provisioning`).

## Files

| File | Purpose |
|------|---------|
| `contact-points.yml` | Email + webhook receivers |
| `notification-policies.yml` | Route `severity=critical` to webhook; `job=edge-gateway` to email |
| `alert-rules.yml` | Grafana-managed rules mirroring Prometheus RED alerts |

Prometheus also evaluates `infra/prometheus/alerts/edge-gateway.yml` independently.

## Enable email delivery

Set in `.env` (see `.env.docker.example`):

```env
GRAFANA_SMTP_ENABLED=true
GRAFANA_SMTP_HOST=smtp.example.com:587
GRAFANA_SMTP_USER=...
GRAFANA_SMTP_PASSWORD=...
GRAFANA_SMTP_FROM=alerts@yourdomain.com
```

Edit `contact-points.yml` → `addresses:` to your ops list, then restart Grafana:

```powershell
docker compose restart grafana
```

## Webhook receiver

Default URL `http://control-api:8080/internal/alerts/webhook` is a placeholder until control-api implements it. Point `edge-gateway-ops-webhook` at Slack/PagerDuty, or disable that route in `notification-policies.yml`.

## Verify

1. Open http://localhost:3001 → Alerting → Contact points (should list `edge-gateway-ops-email`).
2. Alerting → Alert rules → folder **Edge Gateway**.
3. Use **Test** on a contact point after SMTP is configured.
