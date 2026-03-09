# ADR 0003: Use Solana for Blockchain Layer

## Status

Accepted

## Context

We need a blockchain platform to enable trustless escrow for proxy transactions. Requirements:
- Fast transaction finality (users shouldn't wait minutes)
- Low transaction costs (micropayments for bandwidth)
- Smart contract capabilities (escrow logic)
- Active ecosystem (wallets, developer tools)

## Decision

We will use **Solana** as our blockchain platform.

## Alternatives Considered

### Option 1: Ethereum (Mainnet)
- **Pros**: Largest ecosystem, most secure, extensive tooling
- **Cons**: High gas fees ($10-100+ per transaction), slow finality
- **Rejected**: Too expensive for micropayments

### Option 2: Ethereum L2 (Polygon, Arbitrum)
- **Pros**: Lower fees than mainnet, Ethereum compatibility
- **Cons**: Still slower than Solana, bridging complexity
- **Rejected**: Solana offers better performance for our use case

### Option 3: Solana
- **Pros**: Sub-second finality, $0.0001 fees, high throughput
- **Cons**: Less decentralized than Ethereum, Rust learning curve
- **Accepted**: Best fit for micropayments and real-time requirements

### Option 4: BSC/Avalanche/other L1s
- **Pros**: EVM compatibility
- **Cons**: Centralization concerns, less developer activity
- **Rejected**: Solana has better performance characteristics

## Consequences

- **Positive**: Transactions confirm in 400ms
- **Positive**: Fees are negligible for users
- **Positive**: Can support real-time streaming payments
- **Negative**: Team must learn Rust for smart contracts
- **Negative**: Smaller wallet ecosystem than Ethereum
- **Negative**: Network outages have occurred historically

## Implementation

- Use **Anchor Framework** for smart contract development
- Support both SOL and SPL tokens (USDC)
- Implement oracle pattern for off-chain data verification
- Build retry mechanisms for transaction resilience

## References

- [Solana Documentation](https://docs.solana.com/)
- [Anchor Framework](https://anchor-lang.com/)
- [Solana vs Ethereum comparison](https://solana.com/news/solana-vs-ethereum)
