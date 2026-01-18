# ProxySocialHub – Cloud-Native Architecture Diagrams

This document contains **visual, cloud-native diagrams** (AWS / GCP style) showing how ProxySocialHub operates today (centralized MVP) and how it evolves toward decentralization.

---

## 1. High-Level Cloud Architecture (MVP – Centralized)

```
 ┌──────────────────────────────┐
 │        Internet Users        │
 │  Buyers / Providers / Admin │
 └───────────────┬─────────────┘
                 │ HTTPS
 ┌───────────────▼─────────────┐
 │        CDN / WAF             │
 │ (CloudFront / Cloud Armor)  │
 └───────────────┬─────────────┘
                 │
 ┌───────────────▼─────────────┐
 │     Load Balancer            │
 │ (ALB / GCLB)                 │
 └───────────────┬─────────────┘
                 │
 ┌───────────────▼──────────────────────────────┐
 │              CONTROL PLANE                   │
 │----------------------------------------------│
 │ Auth Service (OAuth/JWT)                     │
 │ User / Provider / Clan Service               │
 │ Marketplace & Billing Engine                 │
 │ Policy / Rate Limiting                       │
 │ REST + gRPC APIs                             │
 └───────────────┬──────────────────────────────┘
                 │ gRPC / Secure API
 ┌───────────────▼──────────────────────────────┐
 │               DATA PLANE                     │
 │----------------------------------------------│
 │ Edge Gateway Cluster (Rust)                  │
 │ TLS Termination                              │
 │ Proxy Routing                                │
 │ Usage Metering                               │
 └───────────────┬──────────────────────────────┘
                 │ Encrypted Tunnel
 ┌───────────────▼─────────────┐
 │        Provider Devices     │
 │  (Desktop / Mobile Agents) │
 └─────────────────────────────┘
```

---

## 2. Control Plane vs Data Plane (Logical View)

```
 ┌─────────────────────────────────────────────┐
 │               CONTROL PLANE                 │
 │---------------------------------------------│
 │ • Identity & Access Management              │
 │ • Clan & Social Hub Logic                   │
 │ • Marketplace Matching                     │
 │ • Billing & Revenue Split                  │
 │ • Compliance & Audit Logs                  │
 └───────────────────▲─────────────────────────┘
                     │ Policies / Tokens
                     │
 ┌───────────────────▼─────────────────────────┐
 │                 DATA PLANE                  │
 │---------------------------------------------│
 │ • Edge Gateway Nodes                        │
 │ • High-performance proxy routing            │
 │ • Sticky sessions                           │
 │ • Metering (bytes / time)                  │
 └───────────────────▲─────────────────────────┘
                     │ Secure Tunnels
                     │
 ┌───────────────────▼─────────────────────────┐
 │              PROVIDER NODES                 │
 │---------------------------------------------│
 │ • Residential / Mobile IPs                  │
 │ • NAT-safe outbound traffic                 │
 │ • Encrypted communication                  │
 └─────────────────────────────────────────────┘
```

---

## 3. Real-Time Proxy Request Flow

```
 Buyer App / Scraper
        │
        │ Proxy Request (HTTP CONNECT)
        ▼
 ┌───────────────────────┐
 │   Edge Gateway        │
 │-----------------------│
 │ Auth Check (Redis)    │
 │ Policy Validation     │
 │ Route Selection       │
 └───────────┬───────────┘
             │ Encrypted Tunnel
             ▼
 ┌───────────────────────┐
 │   Provider Agent      │
 │-----------------------│
 │ Executes Request      │
 │ Returns Response      │
 └───────────┬───────────┘
             │ Usage Metrics
             ▼
 ┌───────────────────────┐
 │ Billing Engine        │
 │-----------------------│
 │ Bytes / Time Metering │
 │ Balance Deduction     │
 │ Provider Reward       │
 └───────────────────────┘
```

---

## 4. Clan-Based Proxy Aggregation

```
 ┌───────────────┐
 │   Clan A      │
 │---------------│
 │ Provider 1    │
 │ Provider 2    │
 │ Provider 3    │
 └───────┬───────┘
         │ Aggregated Supply
         ▼
 ┌──────────────────────────┐
 │   Clan Proxy Pool        │
 │--------------------------│
 │ Unified IP Inventory     │
 │ Load-balanced routing    │
 │ Revenue split rules      │
 └─────────────┬────────────┘
               │
               ▼
        Buyers consume as
        ONE logical provider
```

---

## 5. Security & Privacy Boundary Diagram

```
 ┌──────────────────────────────┐
 │        Control Plane         │
 │------------------------------│
 │ ✔ Identity                   │
 │ ✔ Billing                    │
 │ ✔ Policies                   │
 │ ✖ No payload access          │
 └───────────────┬─────────────┘
                 │
 ┌───────────────▼─────────────┐
 │        Edge Gateway          │
 │------------------------------│
 │ ✔ Routing                    │
 │ ✔ Metering                   │
 │ ✖ No content inspection      │
 └───────────────┬─────────────┘
                 │ Encrypted
 ┌───────────────▼─────────────┐
 │        Provider Device       │
 │------------------------------│
 │ ✔ Executes request           │
 │ ✔ Owns exit IP               │
 │ ✔ User privacy preserved     │
 └──────────────────────────────┘
```

---

## 6. Future Decentralized Architecture (Vision)

```
 ┌─────────────────────────────┐
 │   Decentralized Control     │
 │   (Multi-region APIs)       │
 └───────────────┬─────────────┘
                 │ Signed Policies
 ┌───────────────▼─────────────┐
 │ Provider-Hosted Edge Nodes  │
 │-----------------------------│
 │ Verified binaries           │
 │ Remote attestation          │
 │ mTLS mesh                   │
 └───────────────┬─────────────┘
                 │ Usage Proofs
 ┌───────────────▼─────────────┐
 │ Smart Contracts / Ledger    │
 │-----------------------------│
 │ Escrow billing              │
 │ Clan revenue split          │
 │ DAO governance              │
 └─────────────────────────────┘
```

---

## Summary
These diagrams reflect:
- Your **centralized-first, decentralized-later** strategy
- Strong **security & privacy boundaries**
- Real-time **marketplace + social hub** behavior
- Clear **upgrade path to Web3 settlement**

