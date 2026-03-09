# ADR 0004: Use Hexagonal Architecture for Control API

## Status

Accepted

## Context

The Control API is the core business logic service. We need an architecture that:
- Is testable (business logic without external dependencies)
- Is maintainable (clear separation of concerns)
- Allows swapping implementations (database, cache, external services)
- Supports future changes without major refactoring

## Decision

We will use **Hexagonal Architecture** (also known as Ports and Adapters) for the Control API.

```
┌─────────────────────────────────────────────────────────────┐
│                    External World                           │
├─────────────────────────────────────────────────────────────┤
│  HTTP Handler  │  Database    │  Redis    │  Solana Client  │
│  (Primary)     │  (Secondary) │ (Secondary) │  (Secondary)   │
└───────┬─────────────────────────────────────────────────────┘
        │ Adapters (Implementation)
        ▼
┌─────────────────────────────────────────────────────────────┐
│                      Ports (Interfaces)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Repository │  │   Cache     │  │  Blockchain Client  │  │
│  │  Interface  │  │  Interface  │  │     Interface       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Domain (Core Business Logic)           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                 Domain Entities                      │    │
│  │  • User  • Session  • Order  • Escrow              │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Domain Services                         │    │
│  │  • Billing  • Marketplace  • Session Management     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Structure

```
services/control-api/internal/
├── core/
│   ├── domain/          # Business entities and rules
│   ├── ports/           # Interfaces (driven and driving)
│   └── services/        # Business use cases
├── api/                 # HTTP handlers (adapters)
├── db/                  # Database implementations
├── cache/               # Redis implementations
└── solana/              # Blockchain client implementations
```

## Alternatives Considered

### Option 1: Layered Architecture (MVC)
- **Pros**: Simple, widely understood
- **Cons**: Business logic mixed with infrastructure concerns
- **Rejected**: Harder to test, tight coupling

### Option 2: Clean Architecture (Uncle Bob)
- **Pros**: Similar benefits to hexagonal
- **Cons**: More complex directory structure
- **Rejected**: Hexagonal is clearer for our team

### Option 3: Microservices from Day 1
- **Pros**: Independent deployment, scalability
- **Cons**: Operational complexity, network overhead
- **Rejected**: Start with modular monolith, extract later if needed

## Consequences

- **Positive**: Business logic is isolated and testable
- **Positive**: Can swap PostgreSQL for another database easily
- **Positive**: Can mock external dependencies for testing
- **Negative**: More boilerplate code (interfaces)
- **Negative**: Steeper learning curve for new developers
- **Negative**: Directory structure is deeper

## Guidelines

1. Domain layer has **no external dependencies**
2. Dependencies point **inward** toward domain
3. Use **dependency injection** for adapters
4. Keep domain models **pure** (no framework annotations)

## References

- [Hexagonal Architecture by Alistair Cockburn](https://alistair.cockburn.us/hexagonal-architecture/)
- [The Clean Architecture by Uncle Bob](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
