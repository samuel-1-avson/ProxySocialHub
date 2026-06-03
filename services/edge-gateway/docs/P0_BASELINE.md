# P0 operational baseline

Snapshots from `scripts/p0-record-baseline.ps1`. See [`P0_BASELINE_RUNBOOK.md`](P0_BASELINE_RUNBOOK.md) for procedure and SLO targets.

## Run 2026-06-02 23:36:12 +00:00
Note: docker edge-gateway buyer port (9092 metrics listener reset); post provider QUIC client

Machine: HALLDEAN
Metrics URL: http://127.0.0.1:18090/metrics

### Parsed gauges

- `edge_gateway_active_sessions` = 0
- `edge_gateway_active_connections` = 0
- `edge_gateway_healthy_providers` = 1
- `edge_gateway_provider_active_connections` = 0
- `process_resident_memory_bytes` = 22806528

### PromQL (Grafana / Prometheus)

- P99 CONNECT: ``histogram_quantile(0.99, sum(rate(edge_gateway_request_latency_seconds_bucket{method="CONNECT"}[5m])) by (le))``
- Egress Gbps: ``sum(rate(edge_gateway_bandwidth_bytes_total{direction="egress"}[1m])) * 8 / 1e9``
- CPU cores used: ``rate(process_cpu_seconds_total[1m])``

### Raw excerpt (first 80 lines)

```
# HELP edge_gateway_active_connections Number of currently active proxy connections
# TYPE edge_gateway_active_connections gauge
edge_gateway_active_connections 0
# HELP edge_gateway_active_sessions Number of active sessions
# TYPE edge_gateway_active_sessions gauge
edge_gateway_active_sessions 0
# HELP edge_gateway_bandwidth_bytes_total Total bandwidth transferred
# TYPE edge_gateway_bandwidth_bytes_total counter
edge_gateway_bandwidth_bytes_total{direction="down"} 0
edge_gateway_bandwidth_bytes_total{direction="up"} 0
# HELP edge_gateway_bandwidth_rate_bytes_per_second Current bandwidth rate
# TYPE edge_gateway_bandwidth_rate_bytes_per_second gauge
edge_gateway_bandwidth_rate_bytes_per_second{direction="up"} 0
# HELP edge_gateway_circuit_breaker_failures_total Total circuit breaker failures across all providers
# TYPE edge_gateway_circuit_breaker_failures_total counter
edge_gateway_circuit_breaker_failures_total 0
# HELP edge_gateway_circuit_breaker_open_count Number of circuit breakers in each state
# TYPE edge_gateway_circuit_breaker_open_count gauge
edge_gateway_circuit_breaker_open_count{state="closed"} 0
# HELP edge_gateway_connection_errors Connection errors by type
# TYPE edge_gateway_connection_errors counter
edge_gateway_connection_errors{error_type="init"} 0
# HELP edge_gateway_connections_by_country Connections by country code
# TYPE edge_gateway_connections_by_country counter
edge_gateway_connections_by_country{country_code="unknown"} 0
# HELP edge_gateway_healthy_providers Healthy provider nodes registered on this pod (local control handles)
# TYPE edge_gateway_healthy_providers gauge
edge_gateway_healthy_providers 1
# HELP edge_gateway_policy_blocks Policy enforcement blocks
# TYPE edge_gateway_policy_blocks counter
edge_gateway_policy_blocks{reason="init"} 0
# HELP edge_gateway_provider_active_connections Total active connections across all providers
# TYPE edge_gateway_provider_active_connections gauge
edge_gateway_provider_active_connections 0
# HELP edge_gateway_provider_health_score Health score of provider nodes aggregated by country (0-100)
# TYPE edge_gateway_provider_health_score gauge
edge_gateway_provider_health_score{country="unknown"} 0
# HELP edge_gateway_provider_latency_ms Latency to provider nodes aggregated by country
# TYPE edge_gateway_provider_latency_ms gauge
edge_gateway_provider_latency_ms{country="unknown"} 0
# HELP edge_gateway_provider_route_selection_total Provider route resolution outcomes
# TYPE edge_gateway_provider_route_selection_total counter
edge_gateway_provider_route_selection_total{route="local"} 0
edge_gateway_provider_route_selection_total{route="miss"} 0
edge_gateway_provider_route_selection_total{route="remote"} 0
edge_gateway_provider_route_selection_total{route="tunnel_remote"} 0
# HELP edge_gateway_provider_total_bytes Total bytes served by direction
# TYPE edge_gateway_provider_total_bytes counter
edge_gateway_provider_total_bytes{direction="up"} 0
# HELP edge_gateway_rate_limit_hits Rate limit hits by limit type
# TYPE edge_gateway_rate_limit_hits counter
edge_gateway_rate_limit_hits{limit_type="init"} 0
# HELP edge_gateway_request_latency_seconds Request latency distribution
# TYPE edge_gateway_request_latency_seconds histogram
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.001"} 21
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.005"} 23
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.01"} 23
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.025"} 23
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.05"} 23
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.1"} 23
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.25"} 23
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.5"} 23
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="1"} 23
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="2.5"} 23
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="5"} 23
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="10"} 23
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="+Inf"} 23
edge_gateway_request_latency_seconds_sum{method="HEAD",status="501"} 0.004921589999999999
edge_gateway_request_latency_seconds_count{method="HEAD",status="501"} 23
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.001"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.005"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.01"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.025"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.05"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.1"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.25"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.5"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="1"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="2.5"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="5"} 0
```


## Run 2026-06-03 04:29:47 +00:00
Note: post METRICS_PORT rebuild; dedicated listener OK

Machine: HALLDEAN
Metrics URL: http://127.0.0.1:9092/metrics

### Parsed gauges

- `edge_gateway_active_sessions` = 0
- `edge_gateway_active_connections` = 0
- `edge_gateway_healthy_providers` = 0
- `edge_gateway_provider_active_connections` = 0
- `process_resident_memory_bytes` = 23461888

### PromQL (Grafana / Prometheus)

- P99 CONNECT: ``histogram_quantile(0.99, sum(rate(edge_gateway_request_latency_seconds_bucket{method="CONNECT"}[5m])) by (le))``
- Egress Gbps: ``sum(rate(edge_gateway_bandwidth_bytes_total{direction="egress"}[1m])) * 8 / 1e9``
- CPU cores used: ``rate(process_cpu_seconds_total[1m])``

### Raw excerpt (first 80 lines)

```
# HELP edge_gateway_active_connections Number of currently active proxy connections
# TYPE edge_gateway_active_connections gauge
edge_gateway_active_connections 0
# HELP edge_gateway_active_sessions Number of active sessions
# TYPE edge_gateway_active_sessions gauge
edge_gateway_active_sessions 0
# HELP edge_gateway_bandwidth_bytes_total Total bandwidth transferred
# TYPE edge_gateway_bandwidth_bytes_total counter
edge_gateway_bandwidth_bytes_total{direction="down"} 0
edge_gateway_bandwidth_bytes_total{direction="up"} 0
# HELP edge_gateway_bandwidth_rate_bytes_per_second Current bandwidth rate
# TYPE edge_gateway_bandwidth_rate_bytes_per_second gauge
edge_gateway_bandwidth_rate_bytes_per_second{direction="up"} 0
# HELP edge_gateway_circuit_breaker_failures_total Total circuit breaker failures across all providers
# TYPE edge_gateway_circuit_breaker_failures_total counter
edge_gateway_circuit_breaker_failures_total 0
# HELP edge_gateway_circuit_breaker_open_count Number of circuit breakers in each state
# TYPE edge_gateway_circuit_breaker_open_count gauge
edge_gateway_circuit_breaker_open_count{state="closed"} 0
# HELP edge_gateway_connection_errors Connection errors by type
# TYPE edge_gateway_connection_errors counter
edge_gateway_connection_errors{error_type="init"} 0
# HELP edge_gateway_connections_by_country Connections by country code
# TYPE edge_gateway_connections_by_country counter
edge_gateway_connections_by_country{country_code="unknown"} 0
# HELP edge_gateway_healthy_providers Healthy provider nodes registered on this pod (local control handles)
# TYPE edge_gateway_healthy_providers gauge
edge_gateway_healthy_providers 0
# HELP edge_gateway_honeytoken_hits_total Honeytoken decoy access attempts
# TYPE edge_gateway_honeytoken_hits_total counter
edge_gateway_honeytoken_hits_total{attribution="resolved"} 0
edge_gateway_honeytoken_hits_total{attribution="unknown"} 0
# HELP edge_gateway_policy_blocks Policy enforcement blocks
# TYPE edge_gateway_policy_blocks counter
edge_gateway_policy_blocks{reason="init"} 0
# HELP edge_gateway_provider_active_connections Total active connections across all providers
# TYPE edge_gateway_provider_active_connections gauge
edge_gateway_provider_active_connections 0
# HELP edge_gateway_provider_health_score Health score of provider nodes aggregated by country (0-100)
# TYPE edge_gateway_provider_health_score gauge
edge_gateway_provider_health_score{country="unknown"} 0
# HELP edge_gateway_provider_latency_ms Latency to provider nodes aggregated by country
# TYPE edge_gateway_provider_latency_ms gauge
edge_gateway_provider_latency_ms{country="unknown"} 0
# HELP edge_gateway_provider_route_selection_total Provider route resolution outcomes
# TYPE edge_gateway_provider_route_selection_total counter
edge_gateway_provider_route_selection_total{route="local"} 0
edge_gateway_provider_route_selection_total{route="miss"} 0
edge_gateway_provider_route_selection_total{route="remote"} 0
edge_gateway_provider_route_selection_total{route="tunnel_remote"} 0
# HELP edge_gateway_provider_total_bytes Total bytes served by direction
# TYPE edge_gateway_provider_total_bytes counter
edge_gateway_provider_total_bytes{direction="up"} 0
# HELP edge_gateway_rate_limit_hits Rate limit hits by limit type
# TYPE edge_gateway_rate_limit_hits counter
edge_gateway_rate_limit_hits{limit_type="init"} 0
# HELP edge_gateway_request_latency_seconds Request latency distribution
# TYPE edge_gateway_request_latency_seconds histogram
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.001"} 3
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.005"} 3
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.01"} 3
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.025"} 3
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.05"} 3
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.1"} 3
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.25"} 3
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.5"} 3
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="1"} 3
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="2.5"} 3
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="5"} 3
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="10"} 3
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="+Inf"} 3
edge_gateway_request_latency_seconds_sum{method="HEAD",status="501"} 0.000292439
edge_gateway_request_latency_seconds_count{method="HEAD",status="501"} 3
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.001"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.005"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.01"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.025"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.05"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.1"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.25"} 0
```


## Run 2026-06-03 06:19:45 +00:00
Note: steady-state idle; compose healthy stack (buyer :18090, metrics :9092)

Machine: HALLDEAN
Metrics URL: http://127.0.0.1:9092/metrics

### Parsed gauges

- `edge_gateway_active_sessions` = 0
- `edge_gateway_active_connections` = 16830
- `edge_gateway_healthy_providers` = 1
- `edge_gateway_provider_active_connections` = 0
- `process_resident_memory_bytes` = 25165824

### PromQL (Grafana / Prometheus)

- P99 CONNECT: ``histogram_quantile(0.99, sum(rate(edge_gateway_request_latency_seconds_bucket{method="CONNECT"}[5m])) by (le))``
- Egress Gbps: ``sum(rate(edge_gateway_bandwidth_bytes_total{direction="egress"}[1m])) * 8 / 1e9``
- CPU cores used: ``rate(process_cpu_seconds_total[1m])``

### Raw excerpt (first 80 lines)

```
# HELP edge_gateway_active_connections Number of currently active proxy connections
# TYPE edge_gateway_active_connections gauge
edge_gateway_active_connections 16830
# HELP edge_gateway_active_sessions Number of active sessions
# TYPE edge_gateway_active_sessions gauge
edge_gateway_active_sessions 0
# HELP edge_gateway_bandwidth_bytes_total Total bandwidth transferred
# TYPE edge_gateway_bandwidth_bytes_total counter
edge_gateway_bandwidth_bytes_total{direction="down"} 0
edge_gateway_bandwidth_bytes_total{direction="up"} 0
# HELP edge_gateway_bandwidth_rate_bytes_per_second Current bandwidth rate
# TYPE edge_gateway_bandwidth_rate_bytes_per_second gauge
edge_gateway_bandwidth_rate_bytes_per_second{direction="up"} 0
# HELP edge_gateway_circuit_breaker_failures_total Total circuit breaker failures across all providers
# TYPE edge_gateway_circuit_breaker_failures_total counter
edge_gateway_circuit_breaker_failures_total 0
# HELP edge_gateway_circuit_breaker_open_count Number of circuit breakers in each state
# TYPE edge_gateway_circuit_breaker_open_count gauge
edge_gateway_circuit_breaker_open_count{state="closed"} 0
# HELP edge_gateway_connection_errors Connection errors by type
# TYPE edge_gateway_connection_errors counter
edge_gateway_connection_errors{error_type="init"} 0
# HELP edge_gateway_connections_by_country Connections by country code
# TYPE edge_gateway_connections_by_country counter
edge_gateway_connections_by_country{country_code="unknown"} 0
# HELP edge_gateway_healthy_providers Healthy provider nodes registered on this pod (local control handles)
# TYPE edge_gateway_healthy_providers gauge
edge_gateway_healthy_providers 1
# HELP edge_gateway_honeytoken_hits_total Honeytoken decoy access attempts
# TYPE edge_gateway_honeytoken_hits_total counter
edge_gateway_honeytoken_hits_total{attribution="resolved"} 0
edge_gateway_honeytoken_hits_total{attribution="unknown"} 0
# HELP edge_gateway_policy_blocks Policy enforcement blocks
# TYPE edge_gateway_policy_blocks counter
edge_gateway_policy_blocks{reason="init"} 0
# HELP edge_gateway_provider_active_connections Total active connections across all providers
# TYPE edge_gateway_provider_active_connections gauge
edge_gateway_provider_active_connections 0
# HELP edge_gateway_provider_health_score Health score of provider nodes aggregated by country (0-100)
# TYPE edge_gateway_provider_health_score gauge
edge_gateway_provider_health_score{country="unknown"} 0
# HELP edge_gateway_provider_latency_ms Latency to provider nodes aggregated by country
# TYPE edge_gateway_provider_latency_ms gauge
edge_gateway_provider_latency_ms{country="unknown"} 0
# HELP edge_gateway_provider_route_selection_total Provider route resolution outcomes
# TYPE edge_gateway_provider_route_selection_total counter
edge_gateway_provider_route_selection_total{route="local"} 0
edge_gateway_provider_route_selection_total{route="miss"} 0
edge_gateway_provider_route_selection_total{route="remote"} 0
edge_gateway_provider_route_selection_total{route="tunnel_remote"} 0
# HELP edge_gateway_provider_total_bytes Total bytes served by direction
# TYPE edge_gateway_provider_total_bytes counter
edge_gateway_provider_total_bytes{direction="up"} 0
# HELP edge_gateway_rate_limit_hits Rate limit hits by limit type
# TYPE edge_gateway_rate_limit_hits counter
edge_gateway_rate_limit_hits{limit_type="init"} 0
# HELP edge_gateway_request_latency_seconds Request latency distribution
# TYPE edge_gateway_request_latency_seconds histogram
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.001"} 16614
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.005"} 16816
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.01"} 16825
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.025"} 16829
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.05"} 16829
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.1"} 16829
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.25"} 16829
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.5"} 16829
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="1"} 16829
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="2.5"} 16829
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="5"} 16829
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="10"} 16829
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="+Inf"} 16829
edge_gateway_request_latency_seconds_sum{method="CONNECT",status="407"} 9.352650267000026
edge_gateway_request_latency_seconds_count{method="CONNECT",status="407"} 16829
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.001"} 33
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.005"} 33
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.01"} 33
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.025"} 33
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.05"} 33
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.1"} 33
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.25"} 33
```


## Run 2026-06-03 06:22:11 +00:00
Note: post-restart clean idle

Machine: HALLDEAN
Metrics URL: http://127.0.0.1:9092/metrics

### Parsed gauges

- `edge_gateway_active_sessions` = 0
- `edge_gateway_active_connections` = 0
- `edge_gateway_healthy_providers` = 0
- `edge_gateway_provider_active_connections` = 0
- `process_resident_memory_bytes` = 22282240

### PromQL (Grafana / Prometheus)

- P99 CONNECT: ``histogram_quantile(0.99, sum(rate(edge_gateway_request_latency_seconds_bucket{method="CONNECT"}[5m])) by (le))``
- Egress Gbps: ``sum(rate(edge_gateway_bandwidth_bytes_total{direction="egress"}[1m])) * 8 / 1e9``
- CPU cores used: ``rate(process_cpu_seconds_total[1m])``

### Raw excerpt (first 80 lines)

```
# HELP edge_gateway_active_connections Number of currently active proxy connections
# TYPE edge_gateway_active_connections gauge
edge_gateway_active_connections 0
# HELP edge_gateway_active_sessions Number of active sessions
# TYPE edge_gateway_active_sessions gauge
edge_gateway_active_sessions 0
# HELP edge_gateway_bandwidth_bytes_total Total bandwidth transferred
# TYPE edge_gateway_bandwidth_bytes_total counter
edge_gateway_bandwidth_bytes_total{direction="down"} 0
edge_gateway_bandwidth_bytes_total{direction="up"} 0
# HELP edge_gateway_bandwidth_rate_bytes_per_second Current bandwidth rate
# TYPE edge_gateway_bandwidth_rate_bytes_per_second gauge
edge_gateway_bandwidth_rate_bytes_per_second{direction="up"} 0
# HELP edge_gateway_circuit_breaker_failures_total Total circuit breaker failures across all providers
# TYPE edge_gateway_circuit_breaker_failures_total counter
edge_gateway_circuit_breaker_failures_total 0
# HELP edge_gateway_circuit_breaker_open_count Number of circuit breakers in each state
# TYPE edge_gateway_circuit_breaker_open_count gauge
edge_gateway_circuit_breaker_open_count{state="closed"} 0
# HELP edge_gateway_connection_errors Connection errors by type
# TYPE edge_gateway_connection_errors counter
edge_gateway_connection_errors{error_type="init"} 0
# HELP edge_gateway_connections_by_country Connections by country code
# TYPE edge_gateway_connections_by_country counter
edge_gateway_connections_by_country{country_code="unknown"} 0
# HELP edge_gateway_healthy_providers Healthy provider nodes registered on this pod (local control handles)
# TYPE edge_gateway_healthy_providers gauge
edge_gateway_healthy_providers 0
# HELP edge_gateway_honeytoken_hits_total Honeytoken decoy access attempts
# TYPE edge_gateway_honeytoken_hits_total counter
edge_gateway_honeytoken_hits_total{attribution="resolved"} 0
edge_gateway_honeytoken_hits_total{attribution="unknown"} 0
# HELP edge_gateway_policy_blocks Policy enforcement blocks
# TYPE edge_gateway_policy_blocks counter
edge_gateway_policy_blocks{reason="init"} 0
# HELP edge_gateway_provider_active_connections Total active connections across all providers
# TYPE edge_gateway_provider_active_connections gauge
edge_gateway_provider_active_connections 0
# HELP edge_gateway_provider_health_score Health score of provider nodes aggregated by country (0-100)
# TYPE edge_gateway_provider_health_score gauge
edge_gateway_provider_health_score{country="unknown"} 0
# HELP edge_gateway_provider_latency_ms Latency to provider nodes aggregated by country
# TYPE edge_gateway_provider_latency_ms gauge
edge_gateway_provider_latency_ms{country="unknown"} 0
# HELP edge_gateway_provider_route_selection_total Provider route resolution outcomes
# TYPE edge_gateway_provider_route_selection_total counter
edge_gateway_provider_route_selection_total{route="local"} 0
edge_gateway_provider_route_selection_total{route="miss"} 0
edge_gateway_provider_route_selection_total{route="remote"} 0
edge_gateway_provider_route_selection_total{route="tunnel_remote"} 0
# HELP edge_gateway_provider_total_bytes Total bytes served by direction
# TYPE edge_gateway_provider_total_bytes counter
edge_gateway_provider_total_bytes{direction="up"} 0
# HELP edge_gateway_rate_limit_hits Rate limit hits by limit type
# TYPE edge_gateway_rate_limit_hits counter
edge_gateway_rate_limit_hits{limit_type="init"} 0
# HELP edge_gateway_request_latency_seconds Request latency distribution
# TYPE edge_gateway_request_latency_seconds histogram
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.001"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.005"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.01"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.025"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.05"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.1"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.25"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="0.5"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="1"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="2.5"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="5"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="10"} 0
edge_gateway_request_latency_seconds_bucket{method="INIT",status="0",le="+Inf"} 0
edge_gateway_request_latency_seconds_sum{method="INIT",status="0"} 0
edge_gateway_request_latency_seconds_count{method="INIT",status="0"} 0
# HELP edge_gateway_session_auth_failures Session authentication failures
# TYPE edge_gateway_session_auth_failures counter
edge_gateway_session_auth_failures{reason="init"} 0
# HELP edge_gateway_session_cache_evictions_total Total session cache evictions
# TYPE edge_gateway_session_cache_evictions_total counter
edge_gateway_session_cache_evictions_total 0
# HELP edge_gateway_session_cache_hits_total Total session cache hits
```


## Run 2026-06-03 06:26:19 +00:00
Note: post-restart clean idle

Machine: HALLDEAN
Metrics URL: http://127.0.0.1:9092/metrics

### Parsed gauges

- `edge_gateway_active_sessions` = 0
- `edge_gateway_active_connections` = 399
- `edge_gateway_healthy_providers` = 0
- `edge_gateway_provider_active_connections` = 0
- `process_resident_memory_bytes` = 23199744

### PromQL (Grafana / Prometheus)

- P99 CONNECT: ``histogram_quantile(0.99, sum(rate(edge_gateway_request_latency_seconds_bucket{method="CONNECT"}[5m])) by (le))``
- Egress Gbps: ``sum(rate(edge_gateway_bandwidth_bytes_total{direction="egress"}[1m])) * 8 / 1e9``
- CPU cores used: ``rate(process_cpu_seconds_total[1m])``

### Raw excerpt (first 80 lines)

```
# HELP edge_gateway_active_connections Number of currently active proxy connections
# TYPE edge_gateway_active_connections gauge
edge_gateway_active_connections 399
# HELP edge_gateway_active_sessions Number of active sessions
# TYPE edge_gateway_active_sessions gauge
edge_gateway_active_sessions 0
# HELP edge_gateway_bandwidth_bytes_total Total bandwidth transferred
# TYPE edge_gateway_bandwidth_bytes_total counter
edge_gateway_bandwidth_bytes_total{direction="down"} 0
edge_gateway_bandwidth_bytes_total{direction="up"} 0
# HELP edge_gateway_bandwidth_rate_bytes_per_second Current bandwidth rate
# TYPE edge_gateway_bandwidth_rate_bytes_per_second gauge
edge_gateway_bandwidth_rate_bytes_per_second{direction="up"} 0
# HELP edge_gateway_circuit_breaker_failures_total Total circuit breaker failures across all providers
# TYPE edge_gateway_circuit_breaker_failures_total counter
edge_gateway_circuit_breaker_failures_total 0
# HELP edge_gateway_circuit_breaker_open_count Number of circuit breakers in each state
# TYPE edge_gateway_circuit_breaker_open_count gauge
edge_gateway_circuit_breaker_open_count{state="closed"} 0
# HELP edge_gateway_connection_errors Connection errors by type
# TYPE edge_gateway_connection_errors counter
edge_gateway_connection_errors{error_type="init"} 0
# HELP edge_gateway_connections_by_country Connections by country code
# TYPE edge_gateway_connections_by_country counter
edge_gateway_connections_by_country{country_code="unknown"} 0
# HELP edge_gateway_healthy_providers Healthy provider nodes registered on this pod (local control handles)
# TYPE edge_gateway_healthy_providers gauge
edge_gateway_healthy_providers 0
# HELP edge_gateway_honeytoken_hits_total Honeytoken decoy access attempts
# TYPE edge_gateway_honeytoken_hits_total counter
edge_gateway_honeytoken_hits_total{attribution="resolved"} 0
edge_gateway_honeytoken_hits_total{attribution="unknown"} 0
# HELP edge_gateway_policy_blocks Policy enforcement blocks
# TYPE edge_gateway_policy_blocks counter
edge_gateway_policy_blocks{reason="init"} 0
# HELP edge_gateway_provider_active_connections Total active connections across all providers
# TYPE edge_gateway_provider_active_connections gauge
edge_gateway_provider_active_connections 0
# HELP edge_gateway_provider_health_score Health score of provider nodes aggregated by country (0-100)
# TYPE edge_gateway_provider_health_score gauge
edge_gateway_provider_health_score{country="unknown"} 0
# HELP edge_gateway_provider_latency_ms Latency to provider nodes aggregated by country
# TYPE edge_gateway_provider_latency_ms gauge
edge_gateway_provider_latency_ms{country="unknown"} 0
# HELP edge_gateway_provider_route_selection_total Provider route resolution outcomes
# TYPE edge_gateway_provider_route_selection_total counter
edge_gateway_provider_route_selection_total{route="local"} 0
edge_gateway_provider_route_selection_total{route="miss"} 0
edge_gateway_provider_route_selection_total{route="remote"} 0
edge_gateway_provider_route_selection_total{route="tunnel_remote"} 0
# HELP edge_gateway_provider_total_bytes Total bytes served by direction
# TYPE edge_gateway_provider_total_bytes counter
edge_gateway_provider_total_bytes{direction="up"} 0
# HELP edge_gateway_rate_limit_hits Rate limit hits by limit type
# TYPE edge_gateway_rate_limit_hits counter
edge_gateway_rate_limit_hits{limit_type="init"} 0
# HELP edge_gateway_request_latency_seconds Request latency distribution
# TYPE edge_gateway_request_latency_seconds histogram
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.001"} 395
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.005"} 399
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.01"} 399
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.025"} 399
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.05"} 399
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.1"} 399
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.25"} 399
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.5"} 399
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="1"} 399
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="2.5"} 399
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="5"} 399
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="10"} 399
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="+Inf"} 399
edge_gateway_request_latency_seconds_sum{method="CONNECT",status="407"} 0.21798964899999998
edge_gateway_request_latency_seconds_count{method="CONNECT",status="407"} 399
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.001"} 2
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.005"} 2
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.01"} 2
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.025"} 2
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.05"} 2
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.1"} 2
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.25"} 2
```


## Run 2026-06-03 06:26:45 +00:00
Note: after 20x45s CONNECT soak

Machine: HALLDEAN
Metrics URL: http://127.0.0.1:9092/metrics

### Parsed gauges

- `edge_gateway_active_sessions` = 0
- `edge_gateway_active_connections` = 839
- `edge_gateway_healthy_providers` = 1
- `edge_gateway_provider_active_connections` = 0
- `process_resident_memory_bytes` = 24379392

### PromQL (Grafana / Prometheus)

- P99 CONNECT: ``histogram_quantile(0.99, sum(rate(edge_gateway_request_latency_seconds_bucket{method="CONNECT"}[5m])) by (le))``
- Egress Gbps: ``sum(rate(edge_gateway_bandwidth_bytes_total{direction="egress"}[1m])) * 8 / 1e9``
- CPU cores used: ``rate(process_cpu_seconds_total[1m])``

### Raw excerpt (first 80 lines)

```
# HELP edge_gateway_active_connections Number of currently active proxy connections
# TYPE edge_gateway_active_connections gauge
edge_gateway_active_connections 839
# HELP edge_gateway_active_sessions Number of active sessions
# TYPE edge_gateway_active_sessions gauge
edge_gateway_active_sessions 0
# HELP edge_gateway_bandwidth_bytes_total Total bandwidth transferred
# TYPE edge_gateway_bandwidth_bytes_total counter
edge_gateway_bandwidth_bytes_total{direction="down"} 0
edge_gateway_bandwidth_bytes_total{direction="up"} 0
# HELP edge_gateway_bandwidth_rate_bytes_per_second Current bandwidth rate
# TYPE edge_gateway_bandwidth_rate_bytes_per_second gauge
edge_gateway_bandwidth_rate_bytes_per_second{direction="up"} 0
# HELP edge_gateway_circuit_breaker_failures_total Total circuit breaker failures across all providers
# TYPE edge_gateway_circuit_breaker_failures_total counter
edge_gateway_circuit_breaker_failures_total 0
# HELP edge_gateway_circuit_breaker_open_count Number of circuit breakers in each state
# TYPE edge_gateway_circuit_breaker_open_count gauge
edge_gateway_circuit_breaker_open_count{state="closed"} 0
# HELP edge_gateway_connection_errors Connection errors by type
# TYPE edge_gateway_connection_errors counter
edge_gateway_connection_errors{error_type="init"} 0
# HELP edge_gateway_connections_by_country Connections by country code
# TYPE edge_gateway_connections_by_country counter
edge_gateway_connections_by_country{country_code="unknown"} 0
# HELP edge_gateway_healthy_providers Healthy provider nodes registered on this pod (local control handles)
# TYPE edge_gateway_healthy_providers gauge
edge_gateway_healthy_providers 1
# HELP edge_gateway_honeytoken_hits_total Honeytoken decoy access attempts
# TYPE edge_gateway_honeytoken_hits_total counter
edge_gateway_honeytoken_hits_total{attribution="resolved"} 0
edge_gateway_honeytoken_hits_total{attribution="unknown"} 0
# HELP edge_gateway_policy_blocks Policy enforcement blocks
# TYPE edge_gateway_policy_blocks counter
edge_gateway_policy_blocks{reason="init"} 0
# HELP edge_gateway_provider_active_connections Total active connections across all providers
# TYPE edge_gateway_provider_active_connections gauge
edge_gateway_provider_active_connections 0
# HELP edge_gateway_provider_health_score Health score of provider nodes aggregated by country (0-100)
# TYPE edge_gateway_provider_health_score gauge
edge_gateway_provider_health_score{country="unknown"} 0
# HELP edge_gateway_provider_latency_ms Latency to provider nodes aggregated by country
# TYPE edge_gateway_provider_latency_ms gauge
edge_gateway_provider_latency_ms{country="unknown"} 0
# HELP edge_gateway_provider_route_selection_total Provider route resolution outcomes
# TYPE edge_gateway_provider_route_selection_total counter
edge_gateway_provider_route_selection_total{route="local"} 0
edge_gateway_provider_route_selection_total{route="miss"} 0
edge_gateway_provider_route_selection_total{route="remote"} 0
edge_gateway_provider_route_selection_total{route="tunnel_remote"} 0
# HELP edge_gateway_provider_total_bytes Total bytes served by direction
# TYPE edge_gateway_provider_total_bytes counter
edge_gateway_provider_total_bytes{direction="up"} 0
# HELP edge_gateway_rate_limit_hits Rate limit hits by limit type
# TYPE edge_gateway_rate_limit_hits counter
edge_gateway_rate_limit_hits{limit_type="init"} 0
# HELP edge_gateway_request_latency_seconds Request latency distribution
# TYPE edge_gateway_request_latency_seconds histogram
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.001"} 831
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.005"} 839
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.01"} 839
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.025"} 839
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.05"} 839
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.1"} 839
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.25"} 839
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="0.5"} 839
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="1"} 839
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="2.5"} 839
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="5"} 839
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="10"} 839
edge_gateway_request_latency_seconds_bucket{method="CONNECT",status="407",le="+Inf"} 839
edge_gateway_request_latency_seconds_sum{method="CONNECT",status="407"} 0.4604267979999998
edge_gateway_request_latency_seconds_count{method="CONNECT",status="407"} 839
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.001"} 2
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.005"} 2
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.01"} 2
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.025"} 2
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.05"} 2
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.1"} 2
edge_gateway_request_latency_seconds_bucket{method="HEAD",status="501",le="0.25"} 2
```

