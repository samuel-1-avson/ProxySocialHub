# Sprint 1: Analytics Foundation

**Sprint Dates**: April 1 - April 14, 2026  
**Sprint Goal**: Deploy core analytics infrastructure and begin event collection  
**Story Points**: 85  
**Status**: Planning

---

## Sprint Backlog

### Epic: Infrastructure Setup (20 points)

#### Story A1.1: Deploy ClickHouse Cluster
**Points**: 8  
**Assignee**: DevOps Lead  
**Priority**: P0

**Acceptance Criteria**:
- [ ] 3-node ClickHouse cluster running in staging
- [ ] Replication configured (2 replicas per shard)
- [ ] Monitoring enabled (Prometheus exporter)
- [ ] Backup configured (S3)
- [ ] Health checks passing

**Tasks**:
```markdown
- [ ] Create Kubernetes manifests (statefulset, service, configmap)
- [ ] Configure persistent volumes (500GB per node)
- [ ] Set up zookeeper for replication coordination
- [ ] Configure users and permissions
- [ ] Set up Prometheus metrics export
- [ ] Create backup CronJob
- [ ] Document operational procedures
```

**Definition of Done**:
- Cluster responds to queries
- Replication working (test failover)
- Metrics visible in Grafana
- Runbook created

---

#### Story A1.2: Configure NATS JetStream
**Points**: 5  
**Assignee**: DevOps Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] NATS cluster with JetStream enabled
- [ ] Streams created: `analytics.events`, `analytics.metrics`
- [ ] Persistence configured (1GB per stream)
- [ ] Consumer groups configured
- [ ] Monitoring enabled

**Configuration**:
```hcl
# NATS JetStream config
jetstream {
  max_memory_store: 2GB
  max_file_store: 10GB
  
  streams: [
    {
      name: "analytics.events"
      subjects: ["analytics.events.*"]
      retention: limits
      max_msgs: 1000000
      max_bytes: 5GB
      max_age: 7d
    }
  ]
}
```

---

#### Story A1.3: Set Up Monitoring
**Points**: 3  
**Assignee**: DevOps Engineer  
**Priority**: P1

**Acceptance Criteria**:
- [ ] ClickHouse monitoring dashboard in Grafana
- [ ] NATS monitoring dashboard
- [ ] Alerts for cluster health
- [ ] Log aggregation configured

---

### Epic: Analytics SDK (25 points)

#### Story A1.4: Create Analytics SDK
**Points**: 13  
**Assignee**: Backend Lead  
**Priority**: P0

**Acceptance Criteria**:
- [ ] SDK module created (`github.com/proxyhubb/analytics-sdk`)
- [ ] Event tracking API implemented
- [ ] Batching and flushing implemented
- [ ] Error handling and retry logic
- [ ] Context propagation support
- [ ] 90% test coverage

**Interface Design**:
```go
package analytics

type Client interface {
    Track(event string, properties map[string]interface{})
    Identify(userID string, traits map[string]interface{})
    Page(name string, properties map[string]interface{})
    Flush() error
    Close() error
}

type Config struct {
    WriteKey      string
    Endpoint      string        // NATS URL
    FlushSize     int           // default: 100
    FlushInterval time.Duration // default: 5s
    MaxRetries    int           // default: 3
}
```

**Tasks**:
```markdown
- [ ] Create SDK repository structure
- [ ] Implement Client interface
- [ ] Add NATS publisher
- [ ] Implement batching logic
- [ ] Add context propagation
- [ ] Create middleware for automatic tracking
- [ ] Write comprehensive tests
- [ ] Create example usage
- [ ] Write SDK documentation
```

---

#### Story A1.5: Event Schema Validation
**Points**: 5  
**Assignee**: Backend Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] JSON schema defined for all events
- [ ] Schema validation in SDK
- [ ] Schema registry implemented
- [ ] Versioning strategy defined

**Schema Example**:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["event_id", "event_type", "timestamp", "user_id"],
  "properties": {
    "event_id": {"type": "string", "format": "uuid"},
    "event_type": {"type": "string", "pattern": "^[a-z]+\\.[a-z]+$"},
    "timestamp": {"type": "string", "format": "date-time"},
    "user_id": {"type": "string", "format": "uuid"},
    "properties": {"type": "object"}
  }
}
```

---

#### Story A1.6: Middleware for Auto-Tracking
**Points**: 3  
**Assignee**: Backend Engineer  
**Priority**: P1

**Acceptance Criteria**:
- [ ] Gin middleware created
- [ ] Automatic request tracking
- [ ] Error tracking
- [ ] Performance metrics

---

### Epic: Database Schema (15 points)

#### Story A1.7: Create ClickHouse Tables
**Points**: 8  
**Assignee**: Data Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] `user_events` table created
- [ ] `session_analytics` table created
- [ ] `revenue_events` table created
- [ ] Materialized views for aggregations
- [ ] TTL policies configured
- [ ] Indexes optimized

**Table Definitions**:
```sql
-- user_events table
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
```

---

#### Story A1.8: Data Pipeline Consumer
**Points**: 5  
**Assignee**: Backend Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] Consumer service created
- [ ] NATS subscription implemented
- [ ] Batch insert to ClickHouse
- [ ] Error handling and DLQ
- [ ] Metrics exposed

**Implementation**:
```go
// cmd/analytics-consumer/main.go
func main() {
    // Connect to NATS
    nc, _ := nats.Connect(nats.DefaultURL)
    js, _ := nc.JetStream()
    
    // Connect to ClickHouse
    ch := clickhouse.Open(&clickhouse.Options{
        Addr: []string{"clickhouse:9000"},
    })
    
    // Subscribe
    sub, _ := js.Subscribe("analytics.events", func(msg *nats.Msg) {
        var event Event
        json.Unmarshal(msg.Data, &event)
        
        // Batch insert
        batch := ch.PrepareBatch("INSERT INTO user_events")
        batch.Append(event.ID, event.Type, event.Timestamp, ...)
        
        if err := batch.Send(); err != nil {
            msg.Nak() // Negative acknowledge
            return
        }
        
        msg.Ack()
    })
    
    // Block
    select {}
}
```

---

### Epic: Integration (15 points)

#### Story A1.9: Integrate SDK into Control API
**Points**: 8  
**Assignee**: Backend Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] SDK added to control-api dependencies
- [ ] 5 core events tracked:
  - `user.login`
  - `session.created`
  - `escrow.funded`
  - `order.completed`
  - `provider.rated`
- [ ] Middleware configured
- [ ] Events flowing to NATS

**Events to Track**:
```go
// Track in auth.go
analytics.Track("user.login", map[string]interface{}{
    "method": "email", // or "oauth_google", "oauth_github"
    "mfa_used": true,
})

// Track in sessions.go
analytics.Track("session.created", map[string]interface{}{
    "session_type": session.Type,
    "bandwidth_gb": session.BandwidthLimit,
    "price_usd": session.Price,
    "provider_tier": provider.Tier,
})

// Track in escrow.go
analytics.Track("escrow.funded", map[string]interface{}{
    "escrow_id": escrow.ID,
    "amount_sol": escrow.Amount,
    "provider_id": escrow.ProviderID,
    "funding_method": "sol", // or "usdc"
})
```

---

#### Story A1.10: Deployment to Staging
**Points**: 3  
**Assignee**: DevOps Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] Consumer service deployed to staging
- [ ] Environment variables configured
- [ ] Health checks passing
- [ ] Logs flowing to central logging

---

### Epic: Testing (10 points)

#### Story A1.11: SDK Unit Tests
**Points**: 5  
**Assignee**: QA Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] 90% test coverage
- [ ] Unit tests for all public methods
- [ ] Mock NATS server for testing
- [ ] Benchmark tests for performance

---

#### Story A1.12: Integration Tests
**Points**: 3  
**Assignee**: QA Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] End-to-end pipeline test
- [ ] Data integrity verification
- [ ] Failure scenario tests

---

#### Story A1.13: Load Testing
**Points**: 2  
**Assignee**: QA Engineer  
**Priority**: P1

**Acceptance Criteria**:
- [ ] Load test: 10K events/sec
- [ ] Measure latency p99 < 100ms
- [ ] No data loss in 1-hour test

---

## Sprint Schedule

### Week 1 (Apr 1-7)

| Day | Focus | Key Activities |
|-----|-------|----------------|
| Mon | Kickoff | Sprint planning, assign stories |
| Tue | Infrastructure | Start ClickHouse deployment |
| Wed | Infrastructure | Continue ClickHouse, start NATS |
| Thu | SDK | Begin SDK development |
| Fri | SDK | Continue SDK, schema design |

### Week 2 (Apr 8-14)

| Day | Focus | Key Activities |
|-----|-------|----------------|
| Mon | Integration | Consumer service, API integration |
| Tue | Integration | Continue integration, testing |
| Wed | Testing | Unit tests, integration tests |
| Thu | Testing | Load testing, bug fixes |
| Fri | Demo | Sprint demo, retrospective |

---

## Dependencies

| Story | Depends On | Risk Level |
|-------|------------|------------|
| A1.2 | A1.1 | Low |
| A1.5 | A1.4 | Low |
| A1.8 | A1.1, A1.2 | Medium |
| A1.9 | A1.4 | Medium |
| A1.10 | A1.1, A1.8 | Low |
| A1.12 | A1.10 | Low |

---

## Definition of Done

- [ ] All stories meet acceptance criteria
- [ ] Code reviewed and merged
- [ ] Tests passing (90% coverage)
- [ ] Documentation updated
- [ ] Deployed to staging
- [ ] Demo completed
- [ ] No critical bugs

---

## Risks & Blockers

| Risk | Impact | Mitigation | Status |
|------|--------|------------|--------|
| ClickHouse provisioning delays | High | Start immediately, have Docker fallback | Monitoring |
| SDK API design changes | Medium | Review early with team | Prevented |
| NATS JetStream learning curve | Low | Pair programming | Monitoring |

---

## Sprint Demo Agenda

**Date**: April 14, 2026  
**Time**: 2:00 PM  
**Duration**: 30 minutes

1. **Infrastructure Demo** (5 min) - DevOps
   - ClickHouse cluster
   - NATS JetStream
   - Monitoring dashboards

2. **SDK Demo** (10 min) - Backend
   - SDK interface
   - Event tracking in action
   - Batch processing

3. **Integration Demo** (10 min) - Backend
   - Live event flow
   - Data in ClickHouse
   - Query examples

4. **Q&A** (5 min)

---

## Post-Sprint

### Sprint 2 Preparation
- [ ] Stories ready for Sprint 2
- [ ] Dependencies cleared
- [ ] Team capacity confirmed

---

**Sprint Master**: Backend Lead  
**Product Owner**: Product Manager  
**Scrum Master**: Engineering Manager

**Last Updated**: March 9, 2026
