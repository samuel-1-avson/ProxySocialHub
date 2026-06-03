# P4 transport soak snapshots

Auto-appended by `scripts/p4-transport-soak.ps1`. See `P4_TRANSPORT_SOAK_RUNBOOK.md`.

## Scale gate status (2026-06-03)

| Profile | Host | Result |
|---------|------|--------|
| `dev-ladder` (20/30/50 × 45s) | HALLDEAN (Windows dev) | **20 PASS**, **30 PASS** (1 sample hp=0), **50 held** but `/health` timeout — dev saturation |
| `load-lab-10k` | *pending* | Requires Linux ops host, `MAX_CONCURRENT_CONNECTIONS=16384`, ≥3 providers |
| `load-lab-24h` | *pending* | After 10k passes |

**Dev ceiling:** ~30 concurrent CONNECT tunnels with stable metrics/`/health`; 50 tunnels establish but saturate buyer health checks on this laptop.

**Next command (ops host):**

```powershell
# .env: MAX_CONCURRENT_CONNECTIONS=16384
cd services/edge-gateway
.\scripts\p4-transport-soak-scale.ps1 -Profile load-lab-10k
```

## Run 2026-06-03 05:41:42 +00:00

Machine: HALLDEAN
Transport (from gateway logs): unknown
Gateway buyer port: 18090 | metrics: 9092
Target concurrent: 20 | held: 20 | connect failures: 0
Duration: 45s | CONNECT dest: example.com:443
Provider node: node_c034420c-7150-4da6-b84a-d8d9a7d14ba7

### Samples

- `2026-06-03T05:41:10.1107192+00:00` held=20 active_sessions=0 active_connections=14940 healthy_providers=1 rss=27131904
- `2026-06-03T05:41:40.1550346+00:00` held=20 active_sessions=0 active_connections=15457 healthy_providers=1 rss=27131904

### Pass criteria (dev soak)

- At least one CONNECT tunnel established through provider transport
- `edge_gateway_healthy_providers` >= 1 for all samples
- `/health` 200 after releasing tunnels
- Load lab target: 10k+ concurrent streams (raise `SOAK_CONCURRENT` on dedicated hardware)


## Run 2026-06-03 07:26:55 +00:00

Machine: HALLDEAN
Transport (from gateway logs): unknown
Gateway buyer port: 18090 | metrics: 9092
Target concurrent: 50 | held: 50 | connect failures: 0
Health after release: timeout (restart edge-gateway if stuck unhealthy)
Duration: 90s | CONNECT dest: example.com:443
Provider node: node_c034420c-7150-4da6-b84a-d8d9a7d14ba7

### Samples


### Pass criteria (dev soak)

- At least one CONNECT tunnel established through provider transport
- `edge_gateway_healthy_providers` >= 1 for all samples
- `/health` 200 after releasing tunnels
- Load lab target: 10k+ concurrent streams (raise `SOAK_CONCURRENT` on dedicated hardware)


## Run 2026-06-03 07:29:15 +00:00

Machine: HALLDEAN
Transport (from gateway logs): unknown
Gateway buyer port: 18090 | metrics: 9092
Target concurrent: 20 | held: 20 | connect failures: 0
Health after release: 200 OK
Duration: 45s | CONNECT dest: example.com:443
Provider node: node_c034420c-7150-4da6-b84a-d8d9a7d14ba7

### Samples

- `2026-06-03T07:28:40.2698380+00:00` held=20 active_sessions=0 active_connections=900 healthy_providers=1 rss=27262976
- `2026-06-03T07:29:10.3092545+00:00` held=20 active_sessions=0 active_connections=1421 healthy_providers=1 rss=27262976

### Pass criteria (dev soak)

- At least one CONNECT tunnel established through provider transport
- `edge_gateway_healthy_providers` >= 1 for all samples
- `/health` 200 after releasing tunnels
- Load lab target: 10k+ concurrent streams (raise `SOAK_CONCURRENT` on dedicated hardware)


## Run 2026-06-03 07:30:27 +00:00

Machine: HALLDEAN
Transport (from gateway logs): unknown
Gateway buyer port: 18090 | metrics: 9092
Target concurrent: 30 | held: 30 | connect failures: 0
Health after release: 200 OK
Duration: 45s | CONNECT dest: example.com:443
Provider node: node_c034420c-7150-4da6-b84a-d8d9a7d14ba7

### Samples

- `2026-06-03T07:29:52.2043205+00:00` held=30 active_sessions=0 active_connections=2150 healthy_providers=0 rss=29229056
- `2026-06-03T07:30:22.2434866+00:00` held=30 active_sessions=0 active_connections=2661 healthy_providers=1 rss=29229056

### Pass criteria (dev soak)

- At least one CONNECT tunnel established through provider transport
- `edge_gateway_healthy_providers` >= 1 for all samples
- `/health` 200 after releasing tunnels
- Load lab target: 10k+ concurrent streams (raise `SOAK_CONCURRENT` on dedicated hardware)


## Run 2026-06-03 07:35:10 +00:00

Machine: HALLDEAN
Transport (from gateway logs): unknown
Gateway buyer port: 18090 | metrics: 9092
Target concurrent: 50 | held: 50 | connect failures: 0
Health after release: timeout (restart edge-gateway if stuck unhealthy)
Duration: 45s | CONNECT dest: example.com:443
Provider node: node_c034420c-7150-4da6-b84a-d8d9a7d14ba7

### Samples


### Pass criteria (dev soak)

- At least one CONNECT tunnel established through provider transport
- `edge_gateway_healthy_providers` >= 1 for all samples
- `/health` 200 after releasing tunnels
- Load lab target: 10k+ concurrent streams (raise `SOAK_CONCURRENT` on dedicated hardware)

