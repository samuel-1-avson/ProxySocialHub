# ProxySocialHub – Architecture

## High-Level Architecture

### Control Plane vs Data Plane

```
           ┌───────────────────────────┐
           │        CONTROL PLANE       │
           │---------------------------│
           │ Auth & Identity Service   │
           │ Clan & Marketplace Logic  │
           │ Billing Engine            │
           │ Policy & Rate Limiting    │
           │ Monitoring & Analytics    │
           └────────────┬──────────────┘
                        │
                        ▼
           ┌───────────────────────────┐
           │         DATA PLANE         │
           │---------------------------│
           │ Edge Gateway Nodes         │
           │ Proxy Routing              │
           │ Usage Metering             │
           │ Encryption Tunnel          │
           └───────────────────────────┘
```

## Edge Gateway Deployment

### MVP (Centralized)
- Edge Gateways run on **platform-managed servers**
- Full control, easier abuse prevention

### Future (Decentralized)
- Providers run **verified Edge Gateway agents**
- Signed binaries + remote attestation

## Request Flow

```
Buyer → Auth → Edge Gateway → Provider Proxy
           ↓
        Metering
           ↓
        Billing Engine
```

## Decentralization Roadmap
1. Centralized routing & billing
2. Provider-hosted gateways
3. Distributed billing ledger
4. Smart-contract settlement

## Smart Contract (Future Billing)

### Purpose
- Trustless revenue distribution
- Transparent usage accounting

### Contract Responsibilities
- Record usage proofs
- Split payments (provider / clan)
- Enforce escrow and settlement

(Solidity contracts defined in DATABASE.md / Smart Contract section)

