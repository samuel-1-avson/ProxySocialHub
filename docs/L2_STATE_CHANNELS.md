# ProxyHub L2 State Channel Integration Guide

This document provides the definitive technical specification for integrating third-party proxy clients and provider nodes with the ProxyHub Layer 2 protocol.

## Protocol Architecture

ProxyHub utilizes industrial state channels to facilitate high-frequency, low-latency bandwidth transactions. The lifecycle involves a 1:1 relationship between a **Session** and an **On-Chain Escrow**.

### 1. Session Handshake
Before data transfer begins, the Consumer and Provider must establish a session.

1. **Discovery**: Consumer fetches listings from the `control-api`.
2. **Escrow Initialization**: Consumer triggers the `InitializeEscrow` instruction on Solana ($SOL/TAO locked).
3. **Handshake**: Consumer sends the `SessionInit` payload to the Provider's node.

```json
{
  "order_id": "uuid-v4",
  "client_pubkey": "base58-solana-address",
  "timestamp": 1737800000,
  "signature": "ed25519-hex-signature"
}
```

### 2. Live Data Sync & Heartbeats
During data transfer, the node must publish real-time telemetry to the ProxyHub NATS network.

- **Subject**: `proxy.telemetry.v1.heartbeat.<node_id>`
- **Payload**:
    - `active_connections`: Number of concurrent tunnels.
    - `bytes_served`: Cumulative bandwidth count.
    - `latency_ms`: Point-in-time response time.

### 3. ZK-Proof Generation (Usage Proofs)
At regular intervals (e.g., every 100MB), the Provider must generate a usage proof.

- **Proof Inputs**: `(order_id, total_bytes_served, consumer_ack_signature)`.
- **Submission**: Submit to `POST /v1/billing/zk-aggregator/submit`.
- **Purpose**: These proofs are aggregated into a single ZK-Proof submitted to the ZKM verifier on Solana to release milestone funds to the Provider.

### 4. Settlement & Channel Closing
When the session ends or bandwidth is exhausted:

1. **Channel Settlement**: The `control-api` aggregates all verified usage proofs.
2. **Final Claim**: The Provider (or Hub) triggers the `ClaimSettle` instruction on-chain.
3. **Refund**: Any remaining funds in the Escrow PDA are returned to the Consumer.

## Security & Verification

- **Slashing**: Providers who fail to maintain >95% uptime or who submit invalid ZK-Proofs are subject to slashing of their **Node Stake**.
- **Watchtower Monitoring**: The network autonomously monitors for high-velocity outflows and security anomalies.

## API References

- **Control API Base**: `https://api.proxyhubb.com`
- **NATS Discovery**: `nats://nats.proxyhubb.com:4222`
- **Solana Program ID**: `ProxyHub11111111111111111111111111111111`

---

*This guide is production-ready. Zero mock data allowed in implementations.*
