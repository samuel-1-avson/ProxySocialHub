# ProxySocialHub – Social Layer & Core Specifications

This document consolidates **API contracts, database schemas, message flows, security threat modeling, and an execution roadmap** for ProxySocialHub. It is designed to be implementation‑ready and aligned with a cloud‑native, security‑first architecture.

---

## 1. Social Layer API Contracts

### 1.1 gRPC (Primary – Internal & Real‑Time)

```proto
syntax = "proto3";
package proxysocialhub.social;

service SocialService {
  rpc SendMessage (SendMessageRequest) returns (SendMessageResponse);
  rpc StreamMessages (StreamMessagesRequest) returns (stream ChatEvent);
  rpc CreateClan (CreateClanRequest) returns (ClanResponse);
  rpc JoinClan (JoinClanRequest) returns (ClanResponse);
  rpc GetRankings (RankingRequest) returns (RankingResponse);
}

message SendMessageRequest {
  string sender_id = 1;
  string channel_id = 2; // DM or Clan ID
  string content = 3;
}

message ChatEvent {
  string message_id = 1;
  string sender_id = 2;
  string content = 3;
  int64 timestamp = 4;
}
```

**Why gRPC**
- Low‑latency streaming (chat, presence)
- Internal microservice communication
- Strong typing + schema evolution

### 1.2 Gemini / AI Social Moderation API

```json
POST /ai/moderate
{
  "content": "message text",
  "context": "clan_chat"
}

Response:
{
  "risk_score": 0.12,
  "flags": []
}
```

Used for:
- Spam detection
- Abuse prevention
- Automated moderation suggestions

---

## 2. Database Schemas

### 2.1 PostgreSQL (Core & Relational)

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  username TEXT UNIQUE,
  reputation_score FLOAT DEFAULT 0,
  created_at TIMESTAMP
);

CREATE TABLE providers (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  trust_score FLOAT,
  verified BOOLEAN
);

CREATE TABLE clans (
  id UUID PRIMARY KEY,
  name TEXT UNIQUE,
  owner_id UUID REFERENCES users(id)
);

CREATE TABLE clan_members (
  clan_id UUID,
  user_id UUID,
  role TEXT,
  PRIMARY KEY (clan_id, user_id)
);
```

### 2.2 Redis (Ephemeral / Real‑Time)

```text
presence:{user_id} -> online | offline
chat_buffer:{channel_id} -> recent messages
rate_limit:{user_id}
```

Used for:
- Presence
- Typing indicators
- Rate limiting

### 2.3 TSDB (Metrics – Prometheus / Influx)

```text
provider_cpu_usage{provider_id}
provider_bandwidth{provider_id}
proxy_uptime_seconds{provider_id}
```

Collected via signed Rust agent.

---

## 3. Message Flow Diagrams (Textual)

### 3.1 Chat Flow

```
Client → API Gateway → Social Service → Redis (fan‑out)
                         ↓
                      gRPC Stream → Clients
```

### 3.2 Billing Flow

```
Proxy Usage → Metering Service → Billing Engine
           → Deduct Buyer Balance → Credit Provider Wallet
```

### 3.3 Metrics Flow

```
Provider Agent → Metrics Ingest (mTLS)
               → TSDB → Ranking Engine
```

---

## 4. Security Threat Model (STRIDE)

### Spoofing
- mTLS between services
- Hardware‑bound provider agent keys

### Tampering
- Signed metrics payloads
- Immutable billing logs

### Repudiation
- Event sourcing for billing & chat
- Audit trails (WORM storage)

### Information Disclosure
- No packet inspection
- Metadata‑only monitoring
- Field‑level encryption (PII)

### Denial of Service
- Per‑user rate limits
- Adaptive traffic shaping

### Elevation of Privilege
- RBAC (User / Provider / Clan Admin)
- Capability‑based permissions

---

## 5. Milestone‑Based Implementation Roadmap

### Phase 1 – MVP (Weeks 1–4)
- Core user & provider services
- Basic proxy marketplace
- Metered billing engine

### Phase 2 – Social Layer (Weeks 5–8)
- Real‑time chat (WebSocket + gRPC)
- Clans & rankings
- Provider public profiles

### Phase 3 – Security & Scale (Weeks 9–12)
- Provider metrics agent
- STRIDE mitigations
- Horizontal scaling & sharding

### Phase 4 – Advanced & Decentralization Ready
- Smart‑contract escrow (optional)
- Clan revenue splitting
- DAO‑style governance hooks

---

## Final Note

This design intentionally balances **privacy, monetization, scalability, and social trust**. Every component is modular, auditable, and future‑proofed for decentralization.

