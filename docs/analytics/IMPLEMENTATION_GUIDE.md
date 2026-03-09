# Analytics Implementation Guide

Step-by-step guide for implementing the enhanced analytics platform.

## Phase 1: Event Tracking (Week 1)

### 1.1 Install Event Tracking SDK

```bash
# Add to control-api
cd services/control-api
go get github.com/proxyhubb/analytics-sdk
```

### 1.2 Initialize Analytics

```go
// internal/analytics/client.go
package analytics

import (
    "github.com/proxyhubb/analytics-sdk/go"
)

var client *analytics.Client

func Init(config Config) error {
    var err error
    client, err = analytics.NewClient(analytics.Config{
        WriteKey:    config.WriteKey,
        Endpoint:    config.Endpoint, // NATS/Kafka endpoint
        FlushSize:   100,
        FlushInterval: 5 * time.Second,
    })
    return err
}

// Track event
func Track(userID string, eventType string, properties map[string]interface{}) {
    client.Enqueue(analytics.Track{
        UserId:     userID,
        Event:      eventType,
        Properties: properties,
        Timestamp:  time.Now(),
    })
}
```

### 1.3 Track Key Events

```go
// internal/api/sessions.go
func CreateSession(c *gin.Context) {
    // ... create session logic ...
    
    // Track event
    analytics.Track(userID, "session.created", map[string]interface{}{
        "session_id":   session.ID,
        "session_type": session.Type,
        "bandwidth_gb": session.BandwidthLimit,
        "price_usd":    session.Price,
    })
}

// internal/api/escrow.go
func FundEscrow(c *gin.Context) {
    // ... escrow logic ...
    
    analytics.Track(userID, "escrow.funded", map[string]interface{}{
        "escrow_id": escrow.ID,
        "amount_sol": escrow.Amount,
        "provider_id": escrow.ProviderID,
    })
}
```

### 1.4 Middleware for Automatic Tracking

```go
// middleware/analytics.go
func AnalyticsMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        start := time.Now()
        
        c.Next()
        
        // Track request
        analytics.Track(c.GetString("user_id"), "api.request", map[string]interface{}{
            "endpoint":    c.FullPath(),
            "method":      c.Request.Method,
            "status_code": c.Writer.Status(),
            "duration_ms": time.Since(start).Milliseconds(),
            "user_agent":  c.Request.UserAgent(),
        })
    }
}
```

---

## Phase 2: Data Infrastructure (Week 2)

### 2.1 Deploy ClickHouse

```yaml
# infra/clickhouse/deployment.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: clickhouse
spec:
  serviceName: clickhouse
  replicas: 3
  template:
    spec:
      containers:
      - name: clickhouse
        image: clickhouse/clickhouse-server:24.1
        ports:
        - containerPort: 8123
        - containerPort: 9000
        volumeMounts:
        - name: data
          mountPath: /var/lib/clickhouse
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 500Gi
```

### 2.2 Create Tables

```sql
-- migrations/analytics/001_create_events_table.sql

-- Raw events table
CREATE TABLE IF NOT EXISTS user_events (
    event_id UUID,
    event_type LowCardinality(String),
    timestamp DateTime64(3),
    user_id UUID,
    session_id Nullable(UUID),
    properties String, -- JSON
    
    INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 3,
    INDEX idx_event_type event_type TYPE bloom_filter GRANULARITY 3
) ENGINE = MergeTree()
ORDER BY (timestamp, event_type)
PARTITION BY toYYYYMMDD(timestamp)
TTL timestamp + INTERVAL 90 DAY;

-- Materialized view for hourly aggregations
CREATE MATERIALIZED VIEW user_events_hourly_mv
ENGINE = SummingMergeTree()
ORDER BY (hour, event_type)
AS SELECT
    toStartOfHour(timestamp) as hour,
    event_type,
    count() as event_count,
    uniqExact(user_id) as unique_users
FROM user_events
GROUP BY hour, event_type;

-- Sessions analytics
CREATE TABLE IF NOT EXISTS session_analytics (
    session_id UUID,
    user_id UUID,
    provider_id UUID,
    start_time DateTime64(3),
    end_time DateTime64(3),
    duration_seconds UInt32,
    bytes_up UInt64,
    bytes_down UInt64,
    cost_usd Decimal(10, 2),
    quality_score UInt8
) ENGINE = MergeTree()
ORDER BY (start_time, user_id)
PARTITION BY toYYYYMMDD(start_time)
TTL start_time + INTERVAL 1 YEAR;
```

### 2.3 Deploy Kafka/NATS

```yaml
# infra/kafka/deployment.yaml
# Or use managed service: Confluent Cloud, AWS MSK

# For NATS (simpler setup):
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nats
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: nats
        image: nats:2.10
        args:
        - "-js" # Enable JetStream
        - "-m" # Enable monitoring
        - "8222"
```

---

## Phase 3: Stream Processing (Week 3)

### 3.1 Create Consumer

```go
// cmd/analytics-consumer/main.go
package main

import (
    "github.com/nats-io/nats.go"
    "github.com/ClickHouse/clickhouse-go/v2"
)

func main() {
    // Connect to NATS
    nc, err := nats.Connect(nats.DefaultURL)
    if err != nil {
        log.Fatal(err)
    }
    defer nc.Close()
    
    // Create JetStream context
    js, err := nc.JetStream()
    if err != nil {
        log.Fatal(err)
    }
    
    // Connect to ClickHouse
    chConn, err := clickhouse.Open(&clickhouse.Options{
        Addr: []string{"clickhouse:9000"},
        Auth: clickhouse.Auth{
            Database: "analytics",
        },
    })
    if err != nil {
        log.Fatal(err)
    }
    
    // Subscribe to events
    sub, err := js.Subscribe("analytics.events.*", func(msg *nats.Msg) {
        var event Event
        if err := json.Unmarshal(msg.Data, &event); err != nil {
            log.Printf("Failed to unmarshal: %v", err)
            msg.Nak()
            return
        }
        
        // Insert into ClickHouse
        if err := insertEvent(chConn, event); err != nil {
            log.Printf("Failed to insert: %v", err)
            msg.Nak()
            return
        }
        
        msg.Ack()
    }, nats.Durable("analytics-consumer"))
    
    if err != nil {
        log.Fatal(err)
    }
    defer sub.Unsubscribe()
    
    // Keep running
    select {}
}

func insertEvent(conn clickhouse.Conn, event Event) error {
    return conn.Exec(context.Background(), `
        INSERT INTO user_events (event_id, event_type, timestamp, user_id, session_id, properties)
        VALUES (?, ?, ?, ?, ?, ?)
    `, event.ID, event.Type, event.Timestamp, event.UserID, event.SessionID, event.Properties)
}
```

### 3.2 Batch Processing

```go
// Batch insert for better performance
func batchInsert(conn clickhouse.Conn, events []Event) error {
    batch, err := conn.PrepareBatch(context.Background(), `
        INSERT INTO user_events (event_id, event_type, timestamp, user_id, session_id, properties)
    `)
    if err != nil {
        return err
    }
    
    for _, event := range events {
        batch.Append(
            event.ID,
            event.Type,
            event.Timestamp,
            event.UserID,
            event.SessionID,
            event.Properties,
        )
    }
    
    return batch.Send()
}
```

---

## Phase 4: API Layer (Week 4)

### 4.1 Analytics API

```go
// internal/api/analytics.go
package api

import (
    "github.com/ClickHouse/clickhouse-go/v2"
    "github.com/gin-gonic/gin"
)

type AnalyticsHandler struct {
    chConn clickhouse.Conn
}

// GetRealTimeMetrics returns real-time metrics
func (h *AnalyticsHandler) GetRealTimeMetrics(c *gin.Context) {
    metricType := c.Query("metric")
    granularity := c.Query("granularity")
    from := c.Query("from")
    to := c.Query("to")
    
    query := buildMetricQuery(metricType, granularity, from, to)
    
    rows, err := h.chConn.Query(context.Background(), query)
    if err != nil {
        c.JSON(500, gin.H{"error": err.Error()})
        return
    }
    defer rows.Close()
    
    var results []MetricPoint
    for rows.Next() {
        var point MetricPoint
        if err := rows.Scan(&point.Timestamp, &point.Value); err != nil {
            continue
        }
        results = append(results, point)
    }
    
    c.JSON(200, gin.H{"data": results})
}

func buildMetricQuery(metric, granularity, from, to string) string {
    switch metric {
    case "active_users":
        return fmt.Sprintf(`
            SELECT 
                toStartOf%s(timestamp) as time,
                uniqExact(user_id) as value
            FROM user_events
            WHERE timestamp BETWEEN '%s' AND '%s'
            GROUP BY time
            ORDER BY time
        `, granularity, from, to)
    case "revenue":
        return fmt.Sprintf(`
            SELECT 
                toStartOf%s(timestamp) as time,
                SUM(cost_usd) as value
            FROM session_analytics
            WHERE start_time BETWEEN '%s' AND '%s'
            GROUP BY time
            ORDER BY time
        `, granularity, from, to)
    default:
        return ""
    }
}
```

### 4.2 Caching Layer

```go
// internal/analytics/cache.go
package analytics

import (
    "github.com/go-redis/redis/v8"
    "encoding/json"
    "time"
)

type Cache struct {
    client *redis.Client
    ttl    time.Duration
}

func (c *Cache) Get(key string, dest interface{}) bool {
    val, err := c.client.Get(context.Background(), key).Result()
    if err != nil {
        return false
    }
    
    json.Unmarshal([]byte(val), dest)
    return true
}

func (c *Cache) Set(key string, value interface{}, ttl time.Duration) {
    data, _ := json.Marshal(value)
    c.client.Set(context.Background(), key, data, ttl)
}

// Cache key generator
func MetricCacheKey(metric, granularity, from, to string) string {
    return fmt.Sprintf("analytics:metric:%s:%s:%s:%s", metric, granularity, from, to)
}
```

---

## Phase 5: Dashboards (Week 5-6)

### 5.1 Grafana Setup

```yaml
# infra/grafana/dashboards/analytics.yml
apiVersion: 1
providers:
- name: 'Analytics'
  orgId: 1
  folder: 'Analytics'
  type: file
  disableDeletion: false
  editable: true
  options:
    path: /var/lib/grafana/dashboards/analytics
```

### 5.2 Custom Dashboard (React)

```typescript
// apps/web/src/app/dashboard/analytics/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useQuery } from '@tanstack/react-query';

export default function AnalyticsDashboard() {
  const [dateRange, setDateRange] = useState({ from: '2026-03-01', to: '2026-03-09' });
  
  const { data: revenue } = useQuery({
    queryKey: ['revenue', dateRange],
    queryFn: () => fetchMetrics('revenue', 'day', dateRange.from, dateRange.to),
  });
  
  const { data: activeUsers } = useQuery({
    queryKey: ['activeUsers', dateRange],
    queryFn: () => fetchMetrics('active_users', 'hour', dateRange.from, dateRange.to),
    refetchInterval: 30000, // 30 seconds
  });
  
  return (
    <div className="dashboard">
      <h1>Analytics Dashboard</h1>
      
      <div className="metrics-grid">
        <MetricCard 
          title="Revenue" 
          value={`$${revenue?.total?.toFixed(2)}`} 
          trend={revenue?.growth}
        />
        <MetricCard 
          title="Active Users" 
          value={activeUsers?.current}
          trend={activeUsers?.growth}
          realtime
        />
      </div>
      
      <div className="chart-container">
        <h2>Revenue Trend</h2>
        <LineChart width={800} height={400} data={revenue?.data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="timestamp" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="#8884d8" />
        </LineChart>
      </div>
    </div>
  );
}

async function fetchMetrics(metric: string, granularity: string, from: string, to: string) {
  const res = await fetch(
    `/api/v1/analytics/metrics?metric=${metric}&granularity=${granularity}&from=${from}&to=${to}`
  );
  return res.json();
}
```

---

## Phase 6: Real-Time Features (Week 7)

### 6.1 WebSocket Server

```go
// cmd/analytics-ws/main.go
package main

import (
    "github.com/gorilla/websocket"
    "net/http"
)

var upgrader = websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool { return true },
}

func main() {
    http.HandleFunc("/ws/analytics", handleWebSocket)
    http.ListenAndServe(":8082", nil)
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        return
    }
    defer conn.Close()
    
    // Subscribe to metrics updates
    metricsChan := subscribeToMetrics()
    
    for metric := range metricsChan {
        if err := conn.WriteJSON(metric); err != nil {
            break
        }
    }
}
```

### 6.2 Client-Side Real-Time

```typescript
// hooks/useRealtimeMetrics.ts
import { useEffect, useState } from 'react';

export function useRealtimeMetrics(metricType: string) {
  const [data, setData] = useState([]);
  
  useEffect(() => {
    const ws = new WebSocket('wss://api.proxyhubb.com/ws/analytics');
    
    ws.onmessage = (event) => {
      const metric = JSON.parse(event.data);
      if (metric.type === metricType) {
        setData(prev => [...prev.slice(-50), metric]);
      }
    };
    
    return () => ws.close();
  }, [metricType]);
  
  return data;
}
```

---

## Phase 7: Testing & Optimization (Week 8)

### 7.1 Load Testing

```bash
# Test event ingestion
k6 run load-test-analytics.js
```

```javascript
// load-test-analytics.js
import http from 'k6/http';

export const options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '5m', target: 1000 },
    { duration: '2m', target: 2000 },
  ],
};

export default function () {
  const event = {
    event_type: 'test.event',
    user_id: `user_${__VU}`,
    timestamp: new Date().toISOString(),
    properties: { test: true },
  };
  
  http.post('https://api.proxyhubb.com/v1/analytics/events', JSON.stringify(event), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

### 7.2 Query Optimization

```sql
-- Add indexes for common queries
ALTER TABLE user_events ADD INDEX idx_user_timestamp (user_id, timestamp);
ALTER TABLE user_events ADD INDEX idx_event_timestamp (event_type, timestamp);

-- Optimize projections
ALTER TABLE user_events ADD PROJECTION event_counts_projection (
    SELECT 
        toStartOfHour(timestamp) as hour,
        event_type,
        count()
    GROUP BY hour, event_type
);
```

---

## Deployment Checklist

- [ ] ClickHouse cluster deployed
- [ ] NATS/Kafka configured
- [ ] Event tracking SDK integrated
- [ ] Stream processors running
- [ ] API endpoints tested
- [ ] Grafana dashboards imported
- [ ] Alerting rules configured
- [ ] Documentation updated
- [ ] Team trained

---

## Troubleshooting

### Issue: High latency on queries

**Solution**:
```sql
-- Check query performance
EXPLAIN ANALYZE SELECT ...;

-- Add materialized views for common aggregations
CREATE MATERIALIZED VIEW ...
```

### Issue: Events not appearing

**Solution**:
```bash
# Check NATS consumer lag
nats consumer info analytics events-consumer

# Check ClickHouse inserts
SELECT count(), max(timestamp) FROM user_events;
```

---

Last updated: 2026-03-09
