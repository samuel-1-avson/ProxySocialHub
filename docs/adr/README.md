# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records (ADRs) for the ProxyHubb project.

## What is an ADR?

An Architecture Decision Record (ADR) captures an important architectural decision made along with its context and consequences. ADRs help teams understand why certain decisions were made and provide historical context for future developers.

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| 0001 | [Record Architecture Decisions](0001-record-architecture-decisions.md) | Accepted | 2026-03-09 |
| 0002 | [Use Multi-Language Architecture](0002-use-multi-language-architecture.md) | Accepted | 2026-03-09 |
| 0003 | [Use Solana for Blockchain Layer](0003-use-solana-for-blockchain.md) | Accepted | 2026-03-09 |
| 0004 | [Use Hexagonal Architecture for Control API](0004-use-hexagonal-architecture.md) | Accepted | 2026-03-09 |
| 0005 | [Use NATS JetStream for Event Streaming](0005-use-nats-for-messaging.md) | Accepted | 2026-03-09 |
| 0006 | [Use Event-Driven Background Workers](0006-use-event-driven-workers.md) | Accepted | 2026-03-09 |

## Status Key

- **Proposed**: Under discussion, not yet decided
- **Accepted**: Approved and implemented
- **Deprecated**: No longer relevant, superseded
- **Superseded**: Replaced by a newer ADR

## Creating a New ADR

1. Copy the template below
2. Name it `NNNN-descriptive-title.md`
3. Fill in all sections
4. Submit as a PR for review

## ADR Template

```markdown
# ADR NNNN: Title

## Status

Proposed / Accepted / Deprecated / Superseded by [ADR-XXXX](adr-XXXX.md)

## Context

What is the issue that we're seeing that is motivating this decision?

## Decision

What is the change that we're proposing or have agreed to implement?

## Consequences

What becomes easier or more difficult to do because of this change?

### Positive
- 

### Negative
-

## Alternatives Considered

### Option 1: [Name]
- **Pros**: 
- **Cons**: 
- **Decision**: Accepted / Rejected

### Option 2: [Name]
- **Pros**: 
- **Cons**: 
- **Decision**: Accepted / Rejected

## Implementation Notes

Any specific implementation details or guidelines.

## References

- [Link](url)
- [Another Link](url)
```

## Contributing

When proposing a new ADR:

1. Create a PR with the proposed ADR
2. Request review from the architecture team
3. Address feedback
4. Once accepted, update the status and merge

When an ADR is superseded:

1. Mark the old ADR as "Superseded" with a link to the new one
2. Update the new ADR to reference the old one
3. Update this README
