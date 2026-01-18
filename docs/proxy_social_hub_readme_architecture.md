# ProxySocialHub

A **secure, privacy-first, community-driven proxy marketplace** enabling real-time buying and selling of proxy bandwidth by individuals and groups.

---

## 1. High-Level Architecture Overview

ProxySocialHub is built using a **Control Plane / Data Plane separation** to ensure scalability, security, and performance.

### 1.1 Architecture Diagram (Logical)

```
                ┌──────────────────────────┐
                │        Web Dashboard     │
                │        (Next.js)         │
                └────────────┬─────────────┘
                             │ HTTPS
                             ▼
┌──────────────────────────────────────────────────┐
│                CONTROL PLANE                      │
│                                                  │
│  ┌───────────────┐   ┌───────────────────────┐ │
│  │ Auth Service  │   │ Billing & Marketplace │ │
│  │ (JWT/OAuth)   │   │ Engine                │ │
│  └──────┬────────┘   └──────────┬────────────┘ │
│         │                         │              │
│  ┌──────▼────────┐   ┌───────────▼──────────┐ │
│  │ User / Group  │   │ Provider Registry     │ │
│  │ Management    │   │ & Reputation Engine  │ │
│  └───────────────┘   └──────────────────────┘ │
│                                                  │
│  PostgreSQL  |  Redis  |  Prometheus            │
└───────────────────────┬─────────────────────────┘
                        │ Secure Tokens / Policy
                        ▼
┌──────────────────────────────────────────────────┐
│                DATA PLANE                         │
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │          Edge Gateway (Rust)                │ │
│  │  - TLS termination                          │ │
│  │  - Session routing                          │ │
│  │  - Traffic metering                         │ │
│  └───────────────┬────────────────────────────┘ │
│                  │ Encrypted Tunnels (mTLS)     │
│      ┌───────────▼──────────┐   ┌───────────▼──┐│
│      │ Provider Client A     │   │ Provider B   ││
│      │ (Desktop/Mobile)      │   │ (Group)     ││
│      └──────────────────────┘   └──────────────┘│
└──────────────────────────────────────────────────┘
```

---

## 2. Database Schema Design (Core Tables)

### 2.1 Users

```sql
users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  role ENUM('buyer','provider','admin'),
  oauth_provider TEXT,
  created_at TIMESTAMP,
  status ENUM('active','suspended')
)
```

---

### 2.2 Providers

```sql
providers (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  reputation_score FLOAT,
  total_bandwidth_served BIGINT,
  uptime_percent FLOAT,
  is_active BOOLEAN
)
```

---

### 2.3 Groups / Clans

```sql
groups (
  id UUID PRIMARY KEY,
  name TEXT,
  owner_id UUID REFERENCES users(id),
  revenue_split_mode ENUM('equal','weighted'),
  created_at TIMESTAMP
)

group_members (
  group_id UUID REFERENCES groups(id),
  provider_id UUID REFERENCES providers(id)
)
```

---

### 2.4 Billing & Usage

```sql
usage_records (
  id UUID PRIMARY KEY,
  buyer_id UUID,
  provider_id UUID,
  bytes_used BIGINT,
  cost DECIMAL,
  timestamp TIMESTAMP
)

wallets (
  user_id UUID,
  balance DECIMAL
)
```

---

## 3. Developer-Level API Specifications (Core)

### 3.1 Authentication

**POST /auth/login**  
Returns JWT access token

---

### 3.2 Buyer Actions

**POST /buyer/fund-wallet**  
Adds funds to buyer wallet

**GET /buyer/usage**  
Returns real-time usage stats

---

### 3.3 Provider Actions

**POST /provider/register**  
Registers provider node

**GET /provider/earnings**  
Returns earnings summary

---

### 3.4 Group / Clan Actions

**POST /groups/create**  
Creates a provider group

**POST /groups/join**  
Adds provider to group

---

## 4. Security & Compliance (GDPR-Style)

### 4.1 Data Minimization
- No traffic payload storage
- Only metadata required for billing & health

### 4.2 Lawful Processing
- Explicit consent at signup
- Clear purpose limitation

### 4.3 User Rights
- Right to data access
- Right to data deletion
- Right to account anonymization

### 4.4 Technical Safeguards
- Encryption at rest and in transit
- mTLS between providers and gateways
- Role-based access control

---

## 5. ARCHITECTURE.md Summary

### Why Centralized First?
- Faster iteration
- Stronger security controls

### How We Decentralize Later
- Multiple edge gateways
- Provider-run gateways
- Certificate-based trust

---

## 6. README – Vision

ProxySocialHub is designed to become a **global proxy economy**, empowering users to safely monetize bandwidth while protecting identity, privacy, and trust at every layer.

---

**Status:** Active Development  
**Next Milestone:** Multi-Gateway Scaling + Group Billing Engine

