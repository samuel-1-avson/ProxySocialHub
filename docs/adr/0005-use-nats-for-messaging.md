# ADR 0005: Use NATS JetStream for Event Streaming

## Status

Accepted

## Context

We need a message bus for:
- Asynchronous processing (background workers)
- Event streaming between services
- Decoupling components
- Handling peak loads

Requirements:
- Persistence (don't lose messages on crash)
- Horizontal scalability
- Low latency
- Easy operation

## Decision

We will use **NATS with JetStream** as our message bus.

## Alternatives Considered

### Option 1: Apache Kafka
- **Pros**: Industry standard, battle-tested, high throughput
- **Cons**: Complex operation, heavy resource usage, JVM-based
- **Rejected**: Overkill for our scale, operational burden

### Option 2: RabbitMQ
- **Pros**: Mature, feature-rich, good documentation
- **Cons**: Complex clustering, less cloud-native
- **Rejected**: NATS is simpler and faster

### Option 3: Redis Pub/Sub or Streams
- **Pros**: Already in stack, simple
- **Cons**: No persistence in Pub/Sub, memory-only
- **Rejected**: Not suitable for critical events

### Option 4: AWS SNS/SQS or Google Pub/Sub
- **Pros**: Managed, no operation
- **Cons**: Vendor lock-in, latency, cost
- **Rejected**: Want infrastructure portability

### Option 5: NATS JetStream
- **Pros**: Simple, fast, cloud-native, embedded persistence
- **Cons**: Smaller ecosystem than Kafka
- **Accepted**: Best balance of features and simplicity

## Consequences

- **Positive**: Single binary deployment
- **Positive**: Sub-millisecond latency
- **Positive**: At-least-once delivery with JetStream
- **Positive**: Can run on-premise or cloud
- **Negative**: Smaller community than Kafka
- **Negative**: Fewer managed service options

## Implementation

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Control    │────▶│   NATS      │◀────│   Workers   │
│    API      │     │  JetStream  │     │  (15+)      │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    ▼             ▼
              [Stream:      [Stream:
               sessions]      billing]
```

### Streams
- `sessions`: Session lifecycle events
- `billing`: Payment and settlement events
- `notifications`: Email/push notification triggers
- `analytics`: Metrics and analytics events

### Consumers
- `escrow-worker`: Processes escrow settlements
- `notification-worker`: Sends emails and notifications
- `analytics-worker`: Aggregates metrics
- `settlement-worker`: Handles payment payouts

## Configuration

```yaml
# JetStream configuration
jetstream: {
  max_memory_store: 1GB
  max_file_store: 10GB
}

# Stream configuration
streams: [
  {
    name: SESSIONS
    subjects: ["sessions.*"]
    retention: limits
    max_msgs: 1000000
    max_bytes: 1GB
  }
]
```

## References

- [NATS Documentation](https://docs.nats.io/)
- [NATS JetStream](https://docs.nats.io/nats-concepts/jetstream)
- [Comparing NATS and Kafka](https://docs.nats.io/nats-concepts/overview/compare-nats)
