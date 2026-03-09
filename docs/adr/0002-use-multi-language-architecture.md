# ADR 0002: Use Multi-Language Architecture

## Status

Accepted

## Context

We need to choose technology stacks for different components of the ProxyHubb system. The system consists of:
- API backend (business logic)
- Edge proxy (high-performance traffic handling)
- Frontend (user interface)
- Smart contracts (blockchain integration)

## Decision

We will use a **polyglot (multi-language) architecture** optimized for each component:

| Component | Language | Framework | Rationale |
|-----------|----------|-----------|-----------|
| Control API | Go | Gin | Fast compilation, excellent concurrency, strong for network services |
| Edge Gateway | Rust | Tokio/Hyper | Maximum performance, memory safety, zero-cost abstractions |
| Web Frontend | TypeScript | Next.js/React | Type safety, excellent ecosystem, SSR/SSG support |
| Solana Programs | Rust | Anchor | Solana's native language, smart contract safety |

## Alternatives Considered

### Option 1: Single Language (Node.js/TypeScript everywhere)
- **Pros**: Code reuse, single skill set, faster development
- **Cons**: Poor performance for proxy layer, memory issues at scale
- **Rejected**: Would not meet performance requirements for edge proxy

### Option 2: Go for Everything
- **Pros**: Good performance, simple deployment
- **Cons**: Would sacrifice proxy performance; CGO complexity for Solana
- **Rejected**: Rust provides better proxy performance

### Option 3: Rust for Everything
- **Pros**: Maximum performance, memory safety
- **Cons**: Slower development velocity, smaller hiring pool
- **Rejected**: Go is more productive for API development

## Consequences

- **Positive**: Each component uses the best tool for its specific requirements
- **Positive**: Edge gateway achieves sub-millisecond latency with Rust
- **Positive**: API team can iterate quickly with Go
- **Negative**: Team needs expertise in multiple languages
- **Negative**: More complex CI/CD pipeline
- **Negative**: Harder to share code between services

## Mitigations

- Clear service boundaries with gRPC/REST APIs
- Comprehensive documentation for each service
- Docker-based development environment abstracts language differences

## References

- [Go vs Rust for Network Services](https://blog.logrocket.com/go-vs-rust-for-network-services/)
- [Why Discord switched from Go to Rust](https://discord.com/blog/why-discord-is-switching-from-go-to-rust)
