# P4 transport soak snapshots

Auto-appended by `scripts/p4-transport-soak.ps1`. See `P4_TRANSPORT_SOAK_RUNBOOK.md`.


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

