# ProxyHubb User Account System - Architecture Analysis Report

## Executive Summary

This document provides a comprehensive analysis of the ProxyHubb user account system, covering the database architecture, authentication flows, security mechanisms, and account lifecycle management. The system is built on a hybrid architecture using **Supabase Auth** for identity management and a custom **PostgreSQL** database for extended profile and business logic.

---

## 1. System Architecture Overview

### 1.1 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Web App   │  │  Provider   │  │   Mobile    │  │   API/SDK   │        │
│  │   (Next.js) │  │    CLI      │  │    App      │  │   Clients   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
└─────────┼────────────────┼────────────────┼────────────────┼───────────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AUTHENTICATION LAYER                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Supabase Auth (auth.users)                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │   │
│  │  │   OAuth     │  │   Email/    │  │   Wallet    │  │   JWT     │  │   │
│  │  │  Providers  │  │   Password  │  │    Auth     │  │  Tokens   │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │   │
│  └────────────────────┬────────────────────────────────────────────────┘   │
│                       │                                                     │
│  ┌────────────────────┴────────────────────────────────────────────────┐   │
│  │              Custom Authentication (Control API)                      │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │   │
│  │  │   Local     │  │   Provider  │  │    API      │  │  Session  │  │   │
│  │  │    JWT      │  │   Tokens    │  │    Keys     │  │ Management│  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATABASE LAYER                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ auth.users  │  │   profiles  │  │   wallets   │  │   sessions  │        │
│  │  (Supabase) │  │   (Public)  │  │   (Public)  │  │   (Public)  │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │user_settings│  │  api_keys   │  │provider_    │  │notification_│        │
│  │             │  │             │  │  tokens     │  │preferences  │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Core Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Separation of Concerns** | Auth (Supabase) separated from business logic (PostgreSQL) |
| **Multi-tenancy Support** | RLS policies at database level |
| **Security-First** | Encrypted credentials, MFA support, progressive lockout |
| **Scalability** | Horizontal scaling via read replicas, Redis caching |
| **Auditability** | All authentication events logged with IP/device fingerprinting |

---

## 2. Database Schema Analysis

### 2.1 Core User Tables

#### 2.1.1 auth.users (Supabase Auth)

The root identity table managed by Supabase Auth.

```sql
CREATE TABLE auth.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE,
    raw_user_meta_data JSONB,          -- OAuth metadata (avatar, name, etc.)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Key Characteristics:**
- Managed entirely by Supabase Auth service
- Cannot be modified directly by application
- Triggers automatically create `profiles` entries via `on_auth_user_created`

#### 2.1.2 profiles (Primary User Table)

The main application user table containing all profile information.

```sql
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    role VARCHAR(20) DEFAULT 'buyer',           -- buyer, provider, admin
    trust_tier VARCHAR(20) DEFAULT 'new',       -- new, verified, premium
    status VARCHAR(50) DEFAULT 'active',        -- active, pending, suspended, banned
    
    -- Social Profile
    username VARCHAR(50) UNIQUE,
    display_name VARCHAR(100),
    bio TEXT,
    avatar_url TEXT,
    cover_image_url TEXT,
    location VARCHAR(100),
    website VARCHAR(255),
    social_links JSONB,                         -- {"twitter": "...", "github": "..."}
    skills TEXT[],
    
    -- Professional Identity
    professional_title VARCHAR(100),
    experience_years INTEGER DEFAULT 0,
    languages TEXT[],
    primary_specialization VARCHAR(100),
    
    -- Business Profile
    business_name VARCHAR(100),
    tax_id VARCHAR(50),
    
    -- Social Stats
    followers_count INTEGER DEFAULT 0,
    following_count INTEGER DEFAULT 0,
    reviews_count INTEGER DEFAULT 0,
    avg_rating NUMERIC DEFAULT 0,
    verified BOOLEAN DEFAULT FALSE,
    
    -- Provider Stats
    provider_since TIMESTAMPTZ,
    total_bandwidth_sold NUMERIC DEFAULT 0,
    wallet_address VARCHAR(64),                 -- Solana base58 address
    paystack_recipient_code VARCHAR(50),
    
    -- Auth / Verification
    verification_token VARCHAR(255),
    email_verified BOOLEAN DEFAULT FALSE,
    kyc_status VARCHAR(20) DEFAULT 'not_started', -- not_started, pending, verified, rejected
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Indexes:**
```sql
CREATE UNIQUE INDEX profiles_pkey ON profiles(id);
CREATE UNIQUE INDEX profiles_username_key ON profiles(username);
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_status ON profiles(status);
```

**RLS Policies:**
```sql
-- Public read access to profiles
CREATE POLICY "Public profiles are viewable by everyone" 
    ON profiles FOR SELECT USING (true);

-- Users can only update their own profile
CREATE POLICY "Users can update own profile" 
    ON profiles FOR UPDATE USING (auth.uid() = id);

-- Users can insert their own profile (trigger handles this)
CREATE POLICY "Users can insert their own profile" 
    ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
```

---

### 2.2 Authentication & Security Tables

#### 2.2.1 user_settings (Security Configuration)

```sql
CREATE TABLE user_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- MFA/TOTP Settings
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_secret VARCHAR(64),              -- Encrypted
    two_factor_backup_codes TEXT,               -- JSON array of hashed codes
    two_factor_verified_at TIMESTAMPTZ,
    
    -- Session Settings
    session_timeout INTEGER DEFAULT 1440,       -- Minutes (24h default)
    max_concurrent_sessions INTEGER DEFAULT 5,
    allowed_ip_ranges TEXT,                     -- JSON array of allowed CIDRs
    
    -- Security Notifications
    notify_on_new_login BOOLEAN DEFAULT TRUE,
    notify_on_password_change BOOLEAN DEFAULT TRUE,
    notify_on_new_session BOOLEAN DEFAULT FALSE,
    
    -- Preferences
    preferred_language VARCHAR(10) DEFAULT 'en',
    theme VARCHAR(20) DEFAULT 'system',         -- light, dark, system
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 2.2.2 user_sessions (Session Management)

```sql
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Token
    refresh_token VARCHAR(255) UNIQUE,
    token_family VARCHAR(64),                   -- For rotation tracking
    
    -- Device Fingerprint
    ip_address INET NOT NULL,
    user_agent TEXT,
    fingerprint VARCHAR(64),                    -- SHA256 of device info
    
    -- Geolocation
    country VARCHAR(2),
    city VARCHAR(100),
    
    -- Device Info
    device_type VARCHAR(20),                    -- desktop, mobile, tablet
    browser VARCHAR(50),
    os VARCHAR(50),
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    revoked_at TIMESTAMPTZ,
    revoke_reason VARCHAR(100),
    
    -- Timing
    last_active_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Indexes:**
```sql
CREATE INDEX idx_usersession_user ON user_sessions(user_id);
CREATE INDEX idx_usersession_active ON user_sessions(is_active);
CREATE INDEX idx_usersession_token ON user_sessions(refresh_token);
```

#### 2.2.3 login_attempts & account_lockouts (Brute Force Protection)

```sql
CREATE TABLE login_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identifier VARCHAR(255) NOT NULL,           -- IP, email, or wallet
    identifier_type VARCHAR(20) NOT NULL,       -- ip, email, wallet
    success BOOLEAN DEFAULT FALSE,
    failure_reason VARCHAR(100),
    ip_address INET NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE account_lockouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identifier VARCHAR(255) NOT NULL UNIQUE,
    identifier_type VARCHAR(20) NOT NULL,
    failed_attempts INTEGER DEFAULT 0,
    locked_at TIMESTAMPTZ,
    locked_until TIMESTAMPTZ,
    unlocked_at TIMESTAMPTZ,
    lock_reason VARCHAR(100),
    auto_unlock_at TIMESTAMPTZ,                 -- Progressive lockout
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 2.3 Access Control Tables

#### 2.3.1 api_keys (Programmatic Access)

```sql
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    key_hash VARCHAR(64) NOT NULL,              -- SHA256 of key (never expose)
    key_prefix VARCHAR(12) NOT NULL,            -- pk_ + first 8 chars for display
    permissions JSONB,                          -- ["read", "write", "proxy", "admin"]
    rate_limit_per_min INTEGER DEFAULT 100,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);
```

**Permission Levels:**
| Permission | Description |
|------------|-------------|
| `read` | Read-only access to user data |
| `write` | Modify user resources |
| `proxy` | Use proxy services |
| `admin` | Full administrative access |

#### 2.3.2 provider_tokens (CLI Authentication)

```sql
CREATE TABLE provider_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL,                 -- HMAC-SHA256 hashed
    name VARCHAR(100),
    last_used TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ                      -- Soft delete
);
```

---

### 2.4 Financial Tables

#### 2.4.1 wallets (SOL-Only Wallet System)

```sql
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    balance_sol NUMERIC(20,9) DEFAULT 0,        -- All balances in SOL
    
    -- Spending Limits (P2-17)
    limits_enabled BOOLEAN DEFAULT FALSE,
    daily_limit NUMERIC(20,9) DEFAULT 0,
    weekly_limit NUMERIC(20,9) DEFAULT 0,
    monthly_limit NUMERIC(20,9) DEFAULT 0,
    limit_window_start TIMESTAMPTZ DEFAULT NOW(),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Spending Limits Logic:**
- `limits_enabled = false`: No spending restrictions
- `limits_enabled = true`: Each limit of `0` means "zero allowed" (not unlimited)
- Progressive windows track usage within time periods

#### 2.4.2 wallet_ledger (Transaction History)

```sql
CREATE TABLE wallet_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    amount NUMERIC(20,9) NOT NULL,              -- Positive = credit, Negative = debit
    balance_after NUMERIC(20,9) NOT NULL,
    type VARCHAR(50) NOT NULL,                  -- topup, usage, payout, refund, earning, swap
    reference_id VARCHAR(128),                  -- Solana tx signature
    tx_hash VARCHAR(255),
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 2.5 Notification Preferences

```sql
CREATE TABLE notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Channel toggles by category
    social_in_app BOOLEAN DEFAULT TRUE,
    social_email BOOLEAN DEFAULT TRUE,
    social_push BOOLEAN DEFAULT FALSE,
    
    business_in_app BOOLEAN DEFAULT TRUE,
    business_email BOOLEAN DEFAULT TRUE,
    business_push BOOLEAN DEFAULT TRUE,
    
    community_in_app BOOLEAN DEFAULT TRUE,
    community_email BOOLEAN DEFAULT TRUE,
    community_push BOOLEAN DEFAULT FALSE,
    
    system_in_app BOOLEAN DEFAULT TRUE,
    system_email BOOLEAN DEFAULT TRUE,
    system_push BOOLEAN DEFAULT TRUE,
    
    -- Digest settings
    email_digest_frequency VARCHAR(20) DEFAULT 'immediate', -- immediate, hourly, daily, weekly
    digest_day VARCHAR(20) DEFAULT 'monday',
    digest_hour INTEGER DEFAULT 9,
    
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 3. Trust Tier System

### 3.1 Tier Configuration

```go
type TrustTier string

const (
    TrustTierNew      TrustTier = "new"      // Default for new users
    TrustTierVerified TrustTier = "verified" // KYC completed
    TrustTierPremium  TrustTier = "premium"  // High-volume/power users
)

type TierConfig struct {
    Tier              TrustTier
    RequestsPerMinute int
    MaxBandwidthGB    float64  // -1 = unlimited
    MaxConcurrency    int
    AllowAutomation   bool
}
```

### 3.2 Tier Limits

| Tier | Requests/Min | Max Bandwidth | Max Concurrency | Automation |
|------|--------------|---------------|-----------------|------------|
| **New** | 10 | 5 GB | 3 | ❌ |
| **Verified** | 100 | 50 GB | 10 | ✅ |
| **Premium** | 1000 | Unlimited | 100 | ✅ |

---

## 4. Authentication Flows

### 4.1 Multi-Method Authentication Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Authentication Request                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
    ┌──────────────┐ ┌─────────────┐ ┌──────────────┐
    │ Bearer Token │ │ API Key     │ │ Provider     │
    │ (JWT)        │ │ (pk_*)      │ │ Token        │
    └──────┬───────┘ └──────┬──────┘ └──────┬───────┘
           │                │                │
           ▼                ▼                ▼
    ┌──────────────┐ ┌─────────────┐ ┌──────────────┐
    │ 1. Local JWT │ │ Hash &      │ │ HMAC-SHA256  │
    │    Validate  │ │ Lookup      │ │ Validate     │
    └──────┬───────┘ └──────┬──────┘ └──────┬───────┘
           │                │                │
           └────────┬───────┴────────┬──────┘
                    ▼                ▼
         ┌────────────────────────────────┐
         │   Fallback: Supabase Auth API  │
         │   (OAuth/email/wallet auth)    │
         └───────────────┬────────────────┘
                         │
                         ▼
         ┌────────────────────────────────┐
         │      Sync to Local DB          │
         │  (auth.users → profiles)       │
         └────────────────────────────────┘
```

### 4.2 Wallet Authentication Flow (Web3)

```
User                                  Control API
  │                                        │
  │  1. POST /auth/wallet/challenge       │
  │     { address: "5x..." }              │
  │ ─────────────────────────────────────> │
  │                                        │
  │  2. Generate nonce, store in Redis    │
  │     Return: { nonce, message }        │
  │ <───────────────────────────────────── │
  │                                        │
  │  3. Sign message with private key     │
  │     (Solana Ed25519)                  │
  │                                        │
  │  4. POST /auth/wallet/login           │
  │     { address, signature, nonce }     │
  │ ─────────────────────────────────────> │
  │                                        │
  │  5. Verify signature                  │
  │     Create/find user in auth.users    │
  │     Create profile                    │
  │     Create wallet with default limits │
  │     Generate JWT                      │
  │                                        │
  │  6. Return: { token, user }           │
  │ <───────────────────────────────────── │
```

### 4.3 Provider CLI Authentication Flow

```
Provider CLI                          Control API
     │                                     │
     │  1. POST /v1/provider/auth          │
     │     { token: "raw_token" }          │
     │ ───────────────────────────────────>│
     │                                     │
     │  2. HMAC-SHA256 hash token          │
     │     Lookup in provider_tokens       │
     │     Check is_active, not expired    │
     │     Update last_used                │
     │                                     │
     │  3. Create/find node entry          │
     │     Generate short-lived JWT        │
     │                                     │
     │  4. Return: { valid, user_id,       │
     │     jwt_token, node_id }            │
     │ <───────────────────────────────────│
     │                                     │
     │  5. Use JWT for subsequent API      │
     │     calls (Authorization header)    │
```

---

## 5. Security Mechanisms

### 5.1 Account Lockout System

**Progressive Lockout Rules:**
- 5 failed attempts → 30-minute lockout
- Each additional attempt adds 30 minutes
- Auto-unlock when time expires
- Manual unlock by admin possible

```go
func (l *AccountLockout) RecordFailedAttempt() {
    l.FailedAttempts++
    
    if l.FailedAttempts >= 5 {
        now := time.Now()
        l.LockedAt = &now
        l.LockReason = "Too many failed attempts"
        
        // Progressive: 30 min * (attempts - 4)
        lockDuration := time.Duration(l.FailedAttempts-4) * 30 * time.Minute
        l.AutoUnlockAt = &now.Add(lockDuration)
    }
}
```

### 5.2 Session Encryption

Session credentials are encrypted at rest using AES-GCM:

```go
// Before storing in DB
func (s *Session) encryptCredentials() error {
    if s.CredentialsUser != "" {
        s.CredentialsUser, _ = encryptField(s.CredentialsUser)
    }
    if s.CredentialsPass != "" {
        s.CredentialsPass, _ = encryptField(s.CredentialsPass)
    }
    return nil
}

// After loading from DB
func (s *Session) decryptCredentials() error {
    if isEncryptedField(s.CredentialsUser) {
        s.CredentialsUser, _ = decryptField(s.CredentialsUser)
    }
    return nil
}
```

### 5.3 API Key Security

- Raw keys shown **only once** at creation
- Stored as SHA-256 hash
- Prefix stored for display (`pk_xxxx...`)
- Permissions checked on every request

---

## 6. Foreign Key Relationships

```
auth.users (id)
    │
    ├──► profiles (id) [1:1]
    │       │
    │       ├──► wallets (user_id) [1:1]
    │       ├──► user_settings (user_id) [1:1]
    │       ├──► notification_preferences (user_id) [1:1]
    │       │
    │       ├──► api_keys (user_id) [1:N]
    │       ├──► provider_tokens (user_id) [1:N]
    │       ├──► user_sessions (user_id) [1:N]
    │       │
    │       ├──► sessions (user_id) [1:N]
    │       ├──► proxy_listings (seller_id) [1:N]
    │       ├──► provider_nodes (user_id) [1:N]
    │       │
    │       ├──► messages (sender_id) [1:N]
    │       ├──► forum_threads (author_id) [1:N]
    │       ├──► orders (buyer_id/seller_id) [1:N]
    │       └──► ... (40+ related tables)
    │
    └──► All via profiles.id cascade
```

**Total Related Tables:** 41 tables have FK relationships to `profiles`

---

## 7. Entity Relationship Diagram

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   auth.users    │────▶│    profiles      │◀────│     wallets     │
│  (Supabase)     │ 1:1 │   (Main Entity)  │ 1:1 │  (Financial)    │
└─────────────────┘     └────────┬─────────┘     └─────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
┌───────────────┐      ┌─────────────────┐      ┌─────────────────┐
│ user_settings │      │ provider_tokens │      │   api_keys      │
│   (Security)  │      │   (CLI Auth)    │      │ (Programmatic)  │
└───────────────┘      └─────────────────┘      └─────────────────┘
        │                        │                        │
        │                ┌───────┘                        │
        │                │                                │
        ▼                ▼                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      user_sessions                               │
│              (Device Fingerprinting & Tracking)                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Data Flow Architecture

### 8.1 User Registration Flow

```
┌──────────┐    ┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Client  │───▶│ Supabase Auth │───▶│ auth.users    │───▶│   Trigger     │
└──────────┘    └───────────────┘    └───────────────┘    └───────┬───────┘
                                                                    │
                                                                    ▼
┌──────────┐    ┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Wallet  │◀───│    Go API     │◀───│   profiles    │◀───│ on_auth_user  │
│ Created  │    │  (Sync User)  │    │  (Extended)   │    │   _created    │
└──────────┘    └───────────────┘    └───────────────┘    └───────────────┘
```

### 8.2 Authentication Context Flow

```
Request
   │
   ▼
┌──────────────────────────────────────────────────────────────────┐
│ SupabaseAuthMiddleware                                           │
│  1. Extract token from Authorization header                      │
│  2. Try Local JWT (wallet auth)                                  │
│  3. Try Provider Token (CLI)                                     │
│  4. Fallback to Supabase API (OAuth/email)                       │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│ Context Enrichment                                               │
│  - userID (string)                                               │
│  - user_id (uuid.UUID)                                           │
│  - userEmail (string)                                            │
│  - userRole (string: buyer/provider/admin)                       │
│  - auth_type (string)                                            │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   ▼
            ┌──────────┐
            │ Handler  │
            └──────────┘
```

---

## 9. Key Design Decisions

### 9.1 Why Supabase Auth + Custom Profiles?

| Aspect | Supabase Auth | Custom Profiles |
|--------|--------------|-----------------|
| **Identity** | ✅ Handles OAuth, email, MFA | ❌ Not needed |
| **Custom Fields** | ❌ Limited | ✅ Full control |
| **Business Logic** | ❌ Not available | ✅ Full implementation |
| **Performance** | ⚠️ API calls required | ✅ Local queries |
| **Flexibility** | ⚠️ Schema constraints | ✅ Any fields possible |

**Decision:** Use Supabase for identity, custom DB for everything else.

### 9.2 Why SOL-Only Wallets?

- **Simplicity:** Single currency reduces complexity
- **Speed:** Solana fast confirmation times
- **Cost:** Low transaction fees
- **Integration:** Native support for Solana ecosystem

### 9.3 Trust Tier vs. Role Distinction

| | **Role** | **Trust Tier** |
|---|----------|----------------|
| **Purpose** | Functional identity | Reputation/limits |
| **Values** | buyer, provider, admin | new, verified, premium |
| **Changes** | Rare (application-based) | Frequent (behavior-based) |
| **Affects** | UI, permissions | Rate limits, bandwidth |

---

## 10. Scalability Considerations

### 10.1 Read Replicas

All profile reads can be directed to read replicas:
```sql
-- Read replica query
SELECT * FROM profiles WHERE id = $1;

-- Primary DB for writes
UPDATE profiles SET last_active = NOW() WHERE id = $1;
```

### 10.2 Caching Strategy

| Data | Cache Level | TTL |
|------|-------------|-----|
| User profile | Redis | 5 min |
| Wallet balance | Redis | 30 sec |
| API key hash | In-memory | Forever (until restart) |
| Session data | Redis | Session timeout |

### 10.3 Sharding Strategy (Future)

Potential sharding by `user_id` modulo for horizontal scaling:
```sql
-- Shard 0: user_id % 4 = 0
-- Shard 1: user_id % 4 = 1
-- etc.
```

---

## 11. Audit & Compliance

### 11.1 Audit Trail Tables

- `login_attempts` - Every authentication attempt
- `user_sessions` - All active/inactive sessions with device info
- `wallet_ledger` - All financial transactions
- `admin_notes` - Manual actions by admins

### 11.2 PII Handling

| Field | Storage | Encryption |
|-------|---------|------------|
| email | profiles | At rest (DB) |
| wallet_address | profiles | Plain (public) |
| tax_id | profiles | Application-level |
| 2fa_secret | user_settings | AES-256-GCM |
| credentials | sessions | AES-256-GCM |

---

## 12. API Endpoints for User Management

### 12.1 Authentication Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/wallet/challenge` | POST | Get nonce for wallet signing |
| `/auth/wallet/login` | POST | Authenticate with signed message |
| `/auth/dev/login` | POST | Development login (env-restricted) |
| `/auth/me` | GET | Get current user profile |

### 12.2 User Profile Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/profile` | GET | Get own profile |
| `/profile` | PUT | Update profile |
| `/profile/avatar` | POST | Upload avatar |
| `/users/:id` | GET | Get public profile |

### 12.3 Security Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/settings` | GET | Get user settings |
| `/settings` | PUT | Update settings |
| `/settings/2fa/enable` | POST | Enable TOTP |
| `/settings/2fa/verify` | POST | Verify TOTP code |
| `/sessions` | GET | List active sessions |
| `/sessions/:id/revoke` | POST | Revoke session |

### 12.4 API Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api-keys` | GET | List API keys |
| `/api-keys` | POST | Create new key |
| `/api-keys/:id` | DELETE | Revoke key |

---

## 13. Summary Statistics

```
Total User-Related Tables:    15
Total Foreign Key Relations:  41
RLS Policies:                  3
Indexes:                      22
Authentication Methods:        5 (OAuth, Email, Wallet, API Key, Provider Token)
Trust Tiers:                   3
User Roles:                    3
Session Timeout Default:    24 hours
Max Concurrent Sessions:       5
API Key Rate Limit Default:  100 req/min
Progressive Lockout Base:     30 minutes
```

---

## 14. Recommendations

### 14.1 Security Enhancements

1. **Implement WebAuthn/FIDO2** for hardware key support
2. **Add IP allowlisting** for sensitive operations
3. **Implement anomaly detection** for suspicious login patterns
4. **Add audit log table** for GDPR compliance tracking

### 14.2 Performance Optimizations

1. **Materialized view** for user dashboard stats
2. **Connection pooling** optimization for high load
3. **CDN integration** for avatar images
4. **Redis clustering** for session storage

### 14.3 Feature Additions

1. **Organization/Team accounts** for business users
2. **SSO integration** (SAML/OIDC) for enterprise
3. **Referral system** with tracking
4. **Achievement/Gamification** system

---

*Report Generated: March 19, 2026*
*System Version: ProxyHubb Control API v1.0*
*Database: PostgreSQL 15 with Supabase Auth*
