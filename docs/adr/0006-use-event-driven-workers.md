# ADR 0006: Use Event-Driven Background Workers

## Status

Accepted

## Context

The system has many background tasks:
- Processing escrow settlements
- Sending notifications
- Aggregating analytics
- Syncing blockchain state
- Evaluating provider tiers
- Cleaning up expired sessions

We need a reliable, scalable approach to handle these asynchronously.

## Decision

We will use an **event-driven worker architecture** with NATS JetStream as the message broker.

## Worker Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Control API                            │
│  Publishes events to NATS streams                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    NATS JetStream                           │
│  ┌──────────────┬──────────────┬──────────────┐             │
│  │  sessions    │  billing     │  governance  │             │
│  │  stream      │  stream      │  stream      │             │
│  └──────────────┴──────────────┴──────────────┘             │
└─────────────────────────────────────────────────────────────┘
        │                │                │
        ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Session    │ │   Billing    │ │  Governance  │
│   Worker     │ │   Worker     │ │   Worker     │
│              │ │              │ │              │
│ • Reaper     │ │ • Settler    │ │ • Executor   │
│ • Activator  │ │ • Payout     │ │ • Vote tally │
│ • Validator  │ │ • Cleaner    │ │ • Scheduler  │
└──────────────┘ └──────────────┘ └──────────────┘
```

## Worker Categories

### 1. Settlement Workers
| Worker | Purpose | Frequency |
|--------|---------|-----------|
| `SettlementAggregator` | Batch settle escrows | Hourly |
| `ZKSettlementWorker` | Zero-knowledge settlements | Continuous |
| `EscrowCleaner` | Clean expired escrows | 30 minutes |
| `EscrowListener` | Listen to on-chain events | Real-time |

### 2. Provider Workers
| Worker | Purpose | Frequency |
|--------|---------|-----------|
| `TierEvaluator` | Calculate provider tiers | Daily |
| `MarketplaceWatcher` | Monitor marketplace health | Continuous |
| `RegistrySyncWorker` | Sync on-chain registry | 5 minutes |
| `ValidatorSync` | Sync validator state | 5 minutes |

### 3. Session Workers
| Worker | Purpose | Frequency |
|--------|---------|-----------|
| `SessionReaper` | Cleanup expired sessions | Hourly |
| `SessionActivator` | Activate paid sessions | Real-time |
| `ProvisioningWorker` | Provision new sessions | Event-driven |

### 4. Analytics Workers
| Worker | Purpose | Frequency |
|--------|---------|-----------|
| `TelemetryWorker` | Collect system metrics | 1 minute |
| `AnalyticsAggregator` | Aggregate usage stats | Hourly |

## Alternatives Considered

### Option 1: Cron Jobs
- **Pros**: Simple, no extra infrastructure
- **Cons**: No retry logic, hard to scale, no event chaining
- **Rejected**: Not suitable for complex workflows

### Option 2: In-Process Goroutines
- **Pros**: Simple, no external dependency
- **Cons**: Lost on restart, no distribution, hard to monitor
- **Rejected**: Not reliable enough

### Option 3: Celery/RQ (Python)
- **Pros**: Mature, feature-rich
- **Cons**: Python dependency, Redis-only
- **Rejected**: Doesn't fit our Go/Rust stack

### Option 4: Temporal/Cadence
- **Pros**: Durable execution, complex workflows
- **Cons**: Heavy infrastructure, learning curve
- **Rejected**: Overkill for our current needs

## Consequences

- **Positive**: Reliable message delivery (at-least-once)
- **Positive**: Workers can scale independently
- **Positive**: Failed jobs can be retried
- **Positive**: Easy to add new workers
- **Negative**: Eventual consistency complexity
- **Negative**: Need to handle idempotency
- **Negative**: Monitoring distributed work is harder

## Idempotency Pattern

All workers must be idempotent:

```go
func (w *Worker) Process(ctx context.Context, event Event) error {
    // Check if already processed
    if w.isProcessed(event.ID) {
        return nil // Already done
    }
    
    // Process with transaction
    err := w.db.Transaction(func(tx *gorm.DB) error {
        // Do work
        return w.doWork(tx, event)
    })
    
    // Mark as processed
    if err == nil {
        w.markProcessed(event.ID)
    }
    
    return err
}
```

## Monitoring

Each worker exports:
- Processed count
- Error count
- Processing duration
- Queue depth

## References

- [NATS JetStream Consumers](https://docs.nats.io/nats-concepts/jetstream/consumers)
- [Event-Driven Architecture](https://martinfowler.com/articles/201701-event-driven.html)
- [Idempotent Consumer Pattern](https://microservices.io/patterns/communication-style/idempotent-consumer.html)
