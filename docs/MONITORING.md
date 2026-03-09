# Monitoring & Alerting Guide

This document describes the monitoring infrastructure, metrics, and alerting rules for the ProxyHubb system.

## Table of Contents

- [Overview](#overview)
- [Monitoring Stack](#monitoring-stack)
- [Key Metrics](#key-metrics)
- [Dashboards](#dashboards)
- [Alerting](#alerting)
- [Runbooks](#runbooks)
- [Troubleshooting](#troubleshooting)

---

## Overview

Monitoring is essential for maintaining system reliability and quickly identifying issues. Our monitoring strategy covers:

- **Infrastructure**: CPU, memory, disk, network
- **Application**: Request rates, latencies, error rates
- **Business**: Active users, transactions, revenue
- **Blockchain**: Gas usage, transaction success rates

---

## Monitoring Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    Data Collection                          │
├─────────────────────────────────────────────────────────────┤
│  Prometheus  │  Application  │  Node Exporter  │  cAdvisor │
│  (Metrics)   │  (Custom)     │  (System)       │ (Docker)  │
└──────────────┴───────────────┴─────────────────┴───────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Storage & Query                          │
│                      Prometheus                             │
│                   (Time Series DB)                          │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│        Visualization        │  │         Alerting            │
│          Grafana            │  │       AlertManager          │
│       (Dashboards)          │  │    (Alert Routing)          │
└─────────────────────────────┘  └─────────────┬───────────────┘
                                               │
                              ┌────────────────┼────────────────┐
                              ▼                ▼                ▼
                           Slack           PagerDuty         Email
```

### Components

| Component | Purpose | URL |
|-----------|---------|-----|
| Prometheus | Metrics collection | http://localhost:9091 |
| Grafana | Visualization | http://localhost:3001 |
| AlertManager | Alert routing | http://localhost:9093 |
| Node Exporter | System metrics | - |
| cAdvisor | Container metrics | - |

---

## Key Metrics

### 1. Control API (Go)

#### Request Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `http_requests_total` | Counter | Total HTTP requests | method, endpoint, status |
| `http_request_duration_seconds` | Histogram | Request latency | method, endpoint |
| `http_request_size_bytes` | Histogram | Request size | method, endpoint |
| `http_response_size_bytes` | Histogram | Response size | method, endpoint |

#### Business Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `proxyhubb_sessions_active` | Gauge | Number of active sessions |
| `proxyhubb_escrows_total` | Counter | Total escrows created |
| `proxyhubb_escrows_settled` | Counter | Total escrows settled |
| `proxyhubb_users_registered` | Counter | Total user registrations |
| `proxyhubb_bandwidth_bytes` | Counter | Total bandwidth used |

#### Go Runtime Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `go_goroutines` | Gauge | Number of goroutines |
| `go_memstats_alloc_bytes` | Gauge | Allocated memory |
| `go_gc_duration_seconds` | Summary | GC pause duration |

### 2. Edge Gateway (Rust)

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `edge_connections_total` | Counter | Total connections | status |
| `edge_connection_duration_seconds` | Histogram | Connection duration | - |
| `edge_bytes_transferred` | Counter | Bytes transferred | direction |
| `edge_session_auth_failures` | Counter | Auth failures | reason |
| `edge_provider_registry_size` | Gauge | Registered providers | - |
| `edge_circuit_breaker_state` | Gauge | Circuit breaker state | provider |

### 3. Database Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `pg_stat_activity_count` | Gauge | Active connections |
| `pg_stat_database_xact_commit` | Counter | Committed transactions |
| `pg_stat_database_xact_rollback` | Counter | Rolled back transactions |

### 4. Redis Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `redis_connected_clients` | Gauge | Connected clients |
| `redis_used_memory_bytes` | Gauge | Memory usage |
| `redis_keyspace_hits` | Counter | Cache hits |
| `redis_keyspace_misses` | Counter | Cache misses |

### 5. Blockchain Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `solana_transactions_total` | Counter | Total transactions |
| `solana_transactions_failed` | Counter | Failed transactions |
| `solana_confirmation_time_seconds` | Histogram | Confirmation latency |
| `solana_gas_used_lamports` | Counter | Total gas used |

---

## Dashboards

### 1. System Overview

**URL**: http://localhost:3001/d/system-overview

Panels:
- Request rate (RPS)
- Error rate (%)
- P95/P99 latency
- Active connections
- CPU/Memory usage

### 2. API Performance

**URL**: http://localhost:3001/d/api-performance

Panels:
- Endpoint latency heatmap
- Status code distribution
- Rate limiting hits
- Auth failures

### 3. Business Metrics

**URL**: http://localhost:3001/d/business-metrics

Panels:
- Active users (real-time)
- New registrations
- Escrow volume
- Revenue (USD)
- Bandwidth sold (GB)

### 4. Blockchain Health

**URL**: http://localhost:3001/d/blockchain-health

Panels:
- Transaction success rate
- Average confirmation time
- Gas costs
- Oracle health
- Program upgrade status

### 5. Provider Network

**URL**: http://localhost:3001/d/provider-network

Panels:
- Active providers
- Geographic distribution
- Quality scores
- Stake amounts

---

## Alerting

### AlertManager Configuration

Alerts are routed based on severity:

```yaml
# infra/alertmanager/config.yml
route:
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty'
      continue: true
    - match:
        severity: warning
      receiver: 'slack'
```

### Alert Rules

#### Critical Alerts

| Alert | Condition | Action |
|-------|-----------|--------|
| `HighErrorRate` | Error rate > 5% for 5m | Page on-call |
| `HighLatency` | P99 latency > 2s for 5m | Page on-call |
| `ServiceDown` | Health check fails for 2m | Page on-call |
| `DatabaseConnectionsHigh` | Connections > 80% | Page on-call |
| `SolanaOracleDown` | Oracle misses 3 heartbeats | Page on-call |

#### Warning Alerts

| Alert | Condition | Action |
|-------|-----------|--------|
| `ElevatedErrorRate` | Error rate > 1% for 10m | Slack |
| `HighMemoryUsage` | Memory > 80% for 10m | Slack |
| `DiskSpaceLow` | Disk > 85% | Slack |
| `SlowQueries` | P95 query time > 500ms | Slack |
| `CircuitBreakerOpen` | Any CB open | Slack |

#### Info Alerts

| Alert | Condition | Action |
|-------|-----------|--------|
| `DeploymentComplete` | New version deployed | Slack |
| `HighTraffic` | RPS > 10k | Slack |

### Example Alert Rule

```yaml
# infra/prometheus/alerts.yml
groups:
  - name: proxyhubb-api
    rules:
      - alert: HighErrorRate
        expr: |
          (
            sum(rate(http_requests_total{status=~"5.."}[5m]))
            /
            sum(rate(http_requests_total[5m]))
          ) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }}"
```

---

## Runbooks

### High Error Rate

**Symptoms**: Alert fires, users reporting issues

**Steps**:
1. Check Grafana for error breakdown by endpoint
2. Review logs: `kubectl logs -f deployment/control-api`
3. Check if database is responding: `pg_isready`
4. Check external dependencies (Solana, Redis)
5. If specific endpoint failing, check recent deployments
6. Rollback if needed: `kubectl rollout undo deployment/control-api`

### High Latency

**Symptoms**: P99 latency > 2 seconds

**Steps**:
1. Check database query performance
2. Look for slow queries: `pg_stat_statements`
3. Check Redis cache hit rate
4. Verify Solana RPC endpoint health
5. Scale horizontally if needed: `kubectl scale deployment/control-api --replicas=5`

### Database Connection Exhaustion

**Symptoms**: `DatabaseConnectionsHigh` alert

**Steps**:
1. Check active connections: `SELECT * FROM pg_stat_activity;`
2. Look for idle connections
3. Restart connection pool if needed
4. Consider increasing `max_connections`
5. Check for connection leaks in application code

### Solana Transaction Failures

**Symptoms**: `solana_transactions_failed` increasing

**Steps**:
1. Check Solana network status: https://status.solana.com/
2. Verify Oracle wallet has sufficient SOL
3. Check transaction logs for errors
4. Switch to backup RPC endpoint if primary is down
5. Pause new transactions if failure rate > 50%

---

## Troubleshooting

### Metrics Not Appearing

1. Check Prometheus targets: http://localhost:9091/targets
2. Verify `/metrics` endpoint is accessible
3. Check for scraping errors in Prometheus logs
4. Ensure metrics are being registered in code

### Alerts Not Firing

1. Verify AlertManager is running: `docker ps | grep alertmanager`
2. Check alert expression in Prometheus
3. Review AlertManager logs
4. Test routing with amtool: `amtool config routes test`

### Dashboard Shows No Data

1. Check Prometheus data source in Grafana
2. Verify time range is appropriate
3. Check query returns data in Prometheus
4. Review panel query syntax

---

## Adding Custom Metrics

### Go Example

```go
import "github.com/prometheus/client_golang/prometheus"

var (
    escrowsCreated = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "proxyhubb_escrows_created_total",
            Help: "Total number of escrows created",
        },
        []string{"currency"},
    )
)

func init() {
    prometheus.MustRegister(escrowsCreated)
}

// Usage
escrowsCreated.WithLabelValues("SOL").Inc()
```

### Rust Example

```rust
use prometheus::{Counter, Registry};

lazy_static! {
    static ref CONNECTIONS: Counter = Counter::new(
        "edge_connections_total",
        "Total number of connections"
    ).unwrap();
}

// Usage
CONNECTIONS.inc();
```

---

## Resources

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [AlertManager Documentation](https://prometheus.io/docs/alerting/latest/alertmanager/)
- [RED Method](https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/)
- [USE Method](http://www.brendangregg.com/usemethod.html)
