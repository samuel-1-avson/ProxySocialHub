# Real-Time Metrics System

This document describes the real-time metrics infrastructure for ProxyHubb.

## Overview

Real-time metrics enable sub-second visibility into system performance and business KPIs.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  Application    │   System        │   Business    │   Blockchain            │
│  Events         │   Metrics       │   Events      │   Events                │
└───────┬─────────┴────────┬────────┴───────┬───────┴─────────┬───────────────┘
        │                  │                │                 │
        └──────────────────┴────────────────┴─────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    INGESTION (Kafka / NATS)                                │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│   STREAM PROCESSING         │  │   TIME-SERIES DB            │
│   (Flink / Kafka Streams)   │  │   (ClickHouse / Redis)      │
│                             │  │                             │
│   - Windowed aggregations   │  │   - 7-day hot storage       │
│   - Anomaly detection       │  │   - Sub-second queries      │
│   - Alert triggering        │  │   - Automatic downsampling  │
└───────────┬─────────────────┘  └───────────┬─────────────────┘
            │                                │
            └───────────────┬────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    QUERY API                                                 │
│                    - GraphQL / REST                                          │
│                    - Cached responses                                        │
│                    - WebSocket streaming                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VISUALIZATION                                             │
│                    - Grafana dashboards                                      │
│                    - Custom React UI                                         │
│                    - Mobile apps                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Metric Types

### 1. Counter

Monotonically increasing value.

```go
// Examples
proxyhubb_requests_total{method="GET",endpoint="/v1/sessions"}
proxyhubb_escrows_funded_total
proxyhubb_bandwidth_bytes_total
```

### 2. Gauge

Value that can go up or down.

```go
// Examples
proxyhubb_sessions_active
proxyhubb_users_online
proxyhubb_queue_depth
proxyhubb_memory_usage_bytes
```

### 3. Histogram

Distribution of values.

```go
// Examples
proxyhubb_request_duration_seconds_bucket{le="0.1"}
proxyhubb_request_duration_seconds_bucket{le="0.5"}
proxyhubb_request_duration_seconds_bucket{le="1.0"}
proxyhubb_request_duration_seconds_sum
proxyhubb_request_duration_seconds_count
```

### 4. Summary

Similar to histogram but calculates quantiles on client.

```go
// Examples
proxyhubb_request_duration_seconds{quantile="0.5"}
proxyhubb_request_duration_seconds{quantile="0.95"}
proxyhubb_request_duration_seconds{quantile="0.99"}
```

---

## Implementation

### Metric Collection

```go
// internal/metrics/metrics.go
package metrics

import (
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

var (
    // Counters
    RequestsTotal = promauto.NewCounterVec(
        prometheus.CounterOpts{
            Name: "proxyhubb_requests_total",
            Help: "Total HTTP requests",
        },
        []string{"method", "endpoint", "status"},
    )
    
    // Gauges
    ActiveSessions = promauto.NewGauge(
        prometheus.GaugeOpts{
            Name: "proxyhubb_sessions_active",
            Help: "Number of active sessions",
        },
    )
    
    // Histograms
    RequestDuration = promauto.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "proxyhubb_request_duration_seconds",
            Help:    "HTTP request duration",
            Buckets: prometheus.DefBuckets,
        },
        []string{"method", "endpoint"},
    )
)

// Usage in middleware
func MetricsMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        start := time.Now()
        
        c.Next()
        
        duration := time.Since(start).Seconds()
        status := strconv.Itoa(c.Writer.Status())
        
        RequestsTotal.WithLabelValues(
            c.Request.Method,
            c.FullPath(),
            status,
        ).Inc()
        
        RequestDuration.WithLabelValues(
            c.Request.Method,
            c.FullPath(),
        ).Observe(duration)
    }
}
```

### Business Metrics

```go
// Track business events
func TrackEscrowFunded(amount float64) {
    escrowFundedTotal.Add(amount)
    escrowCount.Inc()
}

func TrackSessionStarted(sessionType string, bandwidthGB float64) {
    sessionStarts.WithLabelValues(sessionType).Inc()
    bandwidthAllocated.Add(bandwidthGB)
}
```

---

## Real-Time Aggregations

### Windowed Aggregations

```go
// Stream processing with time windows
type WindowedAggregator struct {
    window    time.Duration
    data      map[string]*Window
}

type Window struct {
    start     time.Time
    count     int64
    sum       float64
    min       float64
    max       float64
}

func (a *WindowedAggregator) Add(metric string, value float64, timestamp time.Time) {
    windowKey := a.getWindowKey(timestamp)
    
    window, exists := a.data[windowKey]
    if !exists {
        window = &Window{
            start: timestamp.Truncate(a.window),
            min:   value,
            max:   value,
        }
        a.data[windowKey] = window
    }
    
    window.count++
    window.sum += value
    if value < window.min {
        window.min = value
    }
    if value > window.max {
        window.max = value
    }
}

func (a *WindowedAggregator) getWindowKey(t time.Time) string {
    return t.Truncate(a.window).Format(time.RFC3339)
}
```

### ClickHouse Materialized Views

```sql
-- Real-time session count
CREATE MATERIALIZED VIEW sessions_realtime_mv
ENGINE = SummingMergeTree()
ORDER BY (timestamp)
AS SELECT
    toStartOfMinute(now()) as timestamp,
    count() as active_sessions,
    sum(bytes_used) as total_bandwidth
FROM sessions
WHERE status = 'active'
GROUP BY timestamp;

-- Query real-time data
SELECT * FROM sessions_realtime_mv
ORDER BY timestamp DESC
LIMIT 1;
```

---

## WebSocket Streaming

### Server

```go
// cmd/metrics-ws/main.go
package main

import (
    "net/http"
    "github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool { return true },
}

func metricsStream(w http.ResponseWriter, r *http.Request) {
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        return
    }
    defer conn.Close()
    
    metricType := r.URL.Query().Get("type")
    
    // Subscribe to metric updates
    updates := metrics.Subscribe(metricType)
    defer metrics.Unsubscribe(updates)
    
    for update := range updates {
        if err := conn.WriteJSON(update); err != nil {
            break
        }
    }
}

func main() {
    http.HandleFunc("/ws/metrics", metricsStream)
    http.ListenAndServe(":8082", nil)
}
```

### Client

```typescript
// hooks/useRealtimeMetric.ts
import { useEffect, useState } from 'react';

export function useRealtimeMetric(metricType: string) {
  const [value, setValue] = useState(null);
  const [history, setHistory] = useState([]);
  
  useEffect(() => {
    const ws = new WebSocket(`wss://api.proxyhubb.com/ws/metrics?type=${metricType}`);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setValue(data.value);
      setHistory(prev => [...prev.slice(-60), data]);
    };
    
    return () => ws.close();
  }, [metricType]);
  
  return { value, history };
}
```

---

## Alerting on Real-Time Metrics

### Threshold Alerts

```yaml
# infra/prometheus/alerts.yml
groups:
  - name: realtime
    rules:
      - alert: HighErrorRateRealtime
        expr: |
          sum(rate(proxyhubb_requests_total{status=~"5.."}[1m])) 
          / 
          sum(rate(proxyhubb_requests_total[1m])) > 0.01
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"
          
      - alert: ActiveSessionsSpike
        expr: |
          (
            proxyhubb_sessions_active 
            - 
            proxyhubb_sessions_active offset 1h
          ) / proxyhubb_sessions_active offset 1h > 0.5
        for: 5m
        labels:
          severity: info
        annotations:
          summary: "Unusual spike in active sessions"
```

### Anomaly Detection

```python
# Real-time anomaly detection
from sklearn.ensemble import IsolationForest
import numpy as np

class AnomalyDetector:
    def __init__(self):
        self.model = IsolationForest(contamination=0.01)
        self.history = []
        
    def update(self, metric_value):
        self.history.append(metric_value)
        
        # Keep last 1000 points
        if len(self.history) > 1000:
            self.history.pop(0)
            
        # Retrain periodically
        if len(self.history) % 100 == 0:
            self.model.fit(np.array(self.history).reshape(-1, 1))
            
    def is_anomaly(self, value):
        if len(self.history) < 100:
            return False
            
        prediction = self.model.predict([[value]])
        return prediction[0] == -1
```

---

## Performance Targets

| Metric | Target | Maximum |
|--------|--------|---------|
| Ingestion Latency | < 1s | 5s |
| Query Latency (p99) | < 100ms | 500ms |
| Dashboard Refresh | 5s | 30s |
| Alert Latency | < 10s | 30s |
| Data Freshness | < 5s | 30s |

---

## Scaling Considerations

### Horizontal Scaling

```
┌─────────────────────────────────────────────────────────────┐
│                    LOAD BALANCER                            │
└─────────────────┬───────────────────────────────────────────┘
                  │
      ┌───────────┼───────────┐
      ▼           ▼           ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│Metrics  │ │Metrics  │ │Metrics  │
│Server 1 │ │Server 2 │ │Server 3 │
└────┬────┘ └────┬────┘ └────┬────┘
     │           │           │
     └───────────┴───────────┘
                 │
                 ▼
        ┌─────────────────┐
        │  Redis Cluster  │
        │  (Pub/Sub)      │
        └─────────────────┘
```

### Data Retention

| Data Granularity | Retention | Storage |
|------------------|-----------|---------|
| Raw (1s) | 1 hour | Hot |
| 1 minute | 7 days | Hot |
| 5 minutes | 30 days | Warm |
| 1 hour | 1 year | Cold |
| 1 day | 5 years | Archive |

---

## Monitoring the Monitoring

Meta-monitoring to ensure metrics system health:

```yaml
# Monitor metric ingestion lag
- alert: MetricsIngestionLag
  expr: time() - max(timestamp(user_events)) > 60
  
# Monitor query performance
- alert: SlowAnalyticsQueries
  expr: histogram_quantile(0.99, rate(query_duration_seconds_bucket[5m])) > 1
```

---

Last updated: 2026-03-09
