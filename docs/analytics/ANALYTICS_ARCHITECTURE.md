# Analytics Architecture

This document describes the enhanced analytics architecture for ProxyHubb.

## Overview

The analytics platform provides real-time insights into business metrics, user behavior, and system performance.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  Application    │   Blockchain    │   External    │   System                │
│  Events         │   Events        │   APIs        │   Metrics               │
│  (NATS)         │   (Solana)      │   (Price)     │   (Prometheus)          │
└───────┬─────────┴────────┬────────┴───────┬───────┴─────────┬───────────────┘
        │                  │                │                 │
        └──────────────────┴────────────────┴─────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    INGESTION LAYER (Apache Kafka / NATS)                    │
│                    Topic Partitioning:                                       │
│                    - user-events                                             │
│                    - transactions                                            │
│                    - system-metrics                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│   STREAM PROCESSING         │  │   BATCH PROCESSING          │
│   (Apache Flink / Kafka     │  │   (Apache Spark / dbt)      │
│   Streams)                  │  │                             │
│                             │  │   - Hourly aggregations     │
│   - Real-time aggregations  │  │   - Daily reports           │
│   - Anomaly detection       │  │   - ML feature engineering  │
│   - Fraud detection         │  │   - Historical analysis     │
└───────────┬─────────────────┘  └───────────┬─────────────────┘
            │                                │
            ▼                                ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│   REAL-TIME STORAGE         │  │   DATA WAREHOUSE            │
│   (ClickHouse / Redis)      │  │   (Snowflake / BigQuery)    │
│                             │  │                             │
│   - 7 days hot data         │  │   - Historical data         │
│   - Sub-second queries      │  │   - Complex analytics       │
│   - Real-time dashboards    │  │   - Data science            │
└───────────┬─────────────────┘  └───────────┬─────────────────┘
            │                                │
            └───────────────┬────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      QUERY LAYER (GraphQL / REST)                           │
│                      Caching: Redis + CDN                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      VISUALIZATION (Grafana / Custom UI)                    │
│                                                                             │
│   - Real-time dashboards   - Executive reports   - Ad-hoc queries          │
│   - Alerting               - ML predictions      - Data exports            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Sources

### 1. Application Events

Events emitted by Control API:

```go
// Event types
type Event struct {
    ID        string    `json:"id"`
    Type      string    `json:"type"`
    Timestamp time.Time `json:"timestamp"`
    UserID    string    `json:"user_id"`
    Data      JSONMap   `json:"data"`
}

// Event categories
const (
    EventUserRegistered    = "user.registered"
    EventSessionCreated    = "session.created"
    EventSessionCompleted  = "session.completed"
    EventOrderCreated      = "order.created"
    EventEscrowFunded      = "escrow.funded"
    EventEscrowSettled     = "escrow.settled"
    EventProviderRated     = "provider.rated"
)
```

### 2. Blockchain Events

Events from Solana:

```rust
// ProxyHub program events
pub struct EscrowInitialized {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
}

pub struct EscrowSettled {
    pub escrow: Pubkey,
    pub seller_payout: u64,
    pub buyer_refund: u64,
}
```

### 3. System Metrics

From Prometheus:

```yaml
# Business metrics
proxyhubb_users_active
proxyhubb_sessions_active
proxyhubb_bandwidth_bytes_total
proxyhubb_escrows_total
proxyhubb_escrows_settled_total
proxyhubb_revenue_usd

# Performance metrics
http_request_duration_seconds
http_requests_total
database_query_duration_seconds
solana_transaction_confirmation_seconds
```

---

## Data Models

### Event Schema

```json
{
  "event_id": "uuid",
  "event_type": "user.registered",
  "timestamp": "2026-03-09T08:30:00Z",
  "user_id": "uuid",
  "session_id": "uuid",
  "properties": {
    "email_domain": "example.com",
    "referral_code": "ABC123",
    "user_agent": "Mozilla/5.0...",
    "ip_address": "1.2.3.4",
    "country": "US"
  },
  "metadata": {
    "version": "1.0",
    "source": "control-api",
    "environment": "production"
  }
}
```

### Analytics Tables (ClickHouse)

```sql
-- Real-time events table
CREATE TABLE user_events (
    event_id UUID,
    event_type LowCardinality(String),
    timestamp DateTime64(3),
    user_id UUID,
    session_id UUID,
    properties String, -- JSON
    
    INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 3,
    INDEX idx_event_type event_type TYPE bloom_filter GRANULARITY 3
) ENGINE = MergeTree()
ORDER BY (timestamp, event_type)
PARTITION BY toYYYYMMDD(timestamp)
TTL timestamp + INTERVAL 30 DAY;

-- Aggregated metrics (materialized view)
CREATE TABLE user_events_aggregated (
    date Date,
    hour UInt8,
    event_type LowCardinality(String),
    count UInt64,
    unique_users UInt64
) ENGINE = SummingMergeTree()
ORDER BY (date, hour, event_type);
```

---

## Stream Processing

### Real-Time Aggregations

```go
// Flink-like stream processing
func ProcessEventStream() {
    stream := kafka.NewConsumer("user-events")
    
    // Windowed aggregations
    hourlyStats := stream.
        Window(time.Hour).
        GroupBy("event_type").
        Aggregate(
            Count(),
            Unique("user_id"),
        )
    
    // Output to ClickHouse
    hourlyStats.Sink(clickhouse.NewSink("user_events_aggregated"))
    
    // Anomaly detection
    anomalies := stream.
        Filter(isAnomalous).
        Sink(alerting.NewSink())
}
```

### Anomaly Detection

```python
# ML-based anomaly detection
from sklearn.ensemble import IsolationForest

def detect_anomalies(event_stream):
    model = IsolationForest(contamination=0.01)
    
    features = extract_features(event_stream)
    predictions = model.fit_predict(features)
    
    anomalies = event_stream[predictions == -1]
    return anomalies
```

---

## Query Layer

### GraphQL Schema

```graphql
type Query {
  # Real-time metrics
  realtimeMetrics(
    metric: MetricType!
    granularity: Granularity!
    from: DateTime!
    to: DateTime!
  ): [MetricPoint!]!
  
  # User analytics
  userAnalytics(
    userId: ID!
    period: TimePeriod!
  ): UserAnalytics!
  
  # Business intelligence
  revenueReport(
    period: TimePeriod!
    groupBy: GroupBy!
  ): RevenueReport!
  
  # Funnel analysis
  funnelAnalysis(
    steps: [String!]!
    period: TimePeriod!
  ): FunnelResult!
}

type MetricPoint {
  timestamp: DateTime!
  value: Float!
  dimensions: JSON
}

type UserAnalytics {
  sessions: Int!
  bandwidthUsed: Float!
  ordersCreated: Int!
  lifetimeValue: Float!
  retentionRate: Float!
}
```

### Query Examples

```graphql
# Get real-time concurrent users
query {
  realtimeMetrics(
    metric: ACTIVE_USERS
    granularity: MINUTE
    from: "2026-03-09T00:00:00Z"
    to: "2026-03-09T23:59:59Z"
  ) {
    timestamp
    value
  }
}

# Revenue by provider tier
query {
  revenueReport(
    period: LAST_30_DAYS
    groupBy: PROVIDER_TIER
  ) {
    segments {
      dimension
      revenue
      growthRate
    }
  }
}
```

---

## Caching Strategy

### Multi-Level Caching

```
┌─────────────────────────────────────────────────────────────┐
│                    CACHE LAYERS                             │
├─────────────────────────────────────────────────────────────┤
│  L1: Browser Cache        │  5 minutes    │  Static assets  │
│  L2: CDN (CloudFlare)     │  1 minute     │  API responses  │
│  L3: Redis Cache          │  30 seconds   │  Hot metrics    │
│  L4: ClickHouse Cache     │  Auto         │  Query results  │
└─────────────────────────────────────────────────────────────┘
```

### Cache Invalidation

```go
// Cache key patterns
const (
    CacheKeyRealTimeMetrics = "analytics:realtime:%s:%s" // metric:granularity
    CacheKeyUserAnalytics   = "analytics:user:%s:%s"     // userID:period
    CacheKeyDashboard       = "analytics:dashboard:%s"   // dashboardID
)

// Invalidate on event
func InvalidateCache(eventType string, userID string) {
    switch eventType {
    case EventSessionCompleted:
        redis.Del(fmt.Sprintf(CacheKeyUserAnalytics, userID, "*"))
    case EventEscrowSettled:
        redis.Del("analytics:realtime:*")
    }
}
```

---

## Data Retention

| Data Type | Hot Storage | Warm Storage | Cold Storage |
|-----------|-------------|--------------|--------------|
| Raw Events | 7 days | 90 days | 2 years |
| Aggregations | 30 days | 1 year | 5 years |
| Metrics | 7 days | 1 year | 3 years |
| User Analytics | 90 days | 1 year | 7 years |

---

## Scalability

### Horizontal Scaling

- **Kafka**: Partition by user_id for parallel processing
- **ClickHouse**: Sharding by date ranges
- **Flink**: Scale task managers based on lag

### Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Event Ingestion | 100K events/sec | TBD |
| Query Latency (p99) | < 100ms | TBD |
| Dashboard Load | < 2s | TBD |
| Data Freshness | < 5s | TBD |

---

## Privacy & Compliance

### Data Anonymization

```go
// PII hashing
func AnonymizeUserID(userID string) string {
    return sha256(userID + salt)[:16]
}

// IP anonymization
func AnonymizeIP(ip string) string {
    // Remove last octet
    parts := strings.Split(ip, ".")
    return fmt.Sprintf("%s.%s.%s.0", parts[0], parts[1], parts[2])
}
```

### GDPR Compliance

- Right to erasure: Delete all user events on request
- Data portability: Export user data in standard format
- Consent tracking: Log analytics consent

---

## Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)
- [ ] Set up Kafka/NATS streaming
- [ ] Deploy ClickHouse cluster
- [ ] Implement event tracking SDK
- [ ] Create base dashboards

### Phase 2: Real-Time (Weeks 3-4)
- [ ] Stream processing with Flink
- [ ] Real-time aggregations
- [ ] Anomaly detection
- [ ] Alerting integration

### Phase 3: Advanced Analytics (Weeks 5-6)
- [ ] Data warehouse (Snowflake)
- [ ] ML models for predictions
- [ ] Funnel analysis
- [ ] Cohort analysis

### Phase 4: Optimization (Weeks 7-8)
- [ ] Query optimization
- [ ] Caching layer
- [ ] Performance tuning
- [ ] Documentation

---

Last updated: 2026-03-09
