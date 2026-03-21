# ProxyHubb Decentralized Authentication Architecture
## Full Web3 Wallet-Based User Account System Analysis

**Version:** 2.0  
**Date:** March 19, 2026  
**Status:** Production Ready  

---

## Executive Summary

ProxyHubb has transitioned from a hybrid authentication system (Supabase Auth + Custom) to a **fully decentralized Web3-native authentication architecture**. The system now uses **Solana wallet signatures** as the sole authentication mechanism, eliminating passwords, email verification, and centralized identity providers.

### Key Changes from v1.0 to v2.0

| Aspect | v1.0 (Legacy) | v2.0 (Current) |
|--------|---------------|----------------|
| **Primary Auth** | Supabase Auth (OAuth/Email) | Solana Wallet (Ed25519) |
| **Identity** | Email-based | Wallet address-based |
| **Passwords** | Required | Eliminated |
| **Sign-up Flow** | Email + Password + Verify | Connect Wallet + Sign Message |
| **Session Storage** | Supabase Session | Local JWT in localStorage |
| **Auth Provider** | Supabase/Google/GitHub | Phantom/Solflare/Any Solana |
| **Account Recovery** | Email reset | Wallet seed phrase |

---

## 1. Decentralized Architecture Overview

### 1.1 High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                      │
│  ┌──────────────────────────────────────────────────────────────────┐      │
│  │                     Web Application (Next.js)                     │      │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │      │
│  │  │  @solana/wallet │  │   Auth Context  │  │  API Client     │  │      │
│  │  │  -adapter-react │  │   (React)       │  │  (JWT Bearer)   │  │      │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │      │
│  │           │                    │                    │          │      │
│  │  ┌────────▼────────────────────▼────────────────────▼────────┐  │      │
│  │  │              Wallet Selection Modal                       │  │      │
│  │  │    (Phantom • Solflare • Backpack • Ledger • Torus)      │  │      │
│  │  └─────────────────────────┬─────────────────────────────────┘  │      │
│  └────────────────────────────┼────────────────────────────────────┘      │
└───────────────────────────────┼───────────────────────────────────────────┘
                                │ Sign Message (Ed25519)
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      AUTHENTICATION LAYER (Control API)                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  POST /auth/wallet/challenge  →  Returns nonce + message           │   │
  │  POST /auth/wallet/login      →  Validates signature, issues JWT   │   │
│  │  GET  /auth/me               →  Returns user profile (JWT auth)    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                │                                            │
│  ┌─────────────────────────────▼──────────────────────────────────────┐   │
│  │                    Authentication Flow                              │   │
│  │                                                                     │   │
│  │  1. Challenge Phase    2. Signature Phase    3. JWT Phase          │   │
│  │  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐       │   │
│  │  │ Generate     │────▶│ Verify       │────▶│ Issue JWT    │       │   │
│  │  │ Random Nonce │     │ Ed25519 Sig  │     │ 24h Expiry   │       │   │
│  │  │ 5-min TTL    │     │ Anti-Replay  │     │ HS256 Signed │       │   │
│  │  └──────────────┘     └──────────────┘     └──────────────┘       │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATABASE LAYER                                      │
│  ┌─────────────┐     ┌─────────────────────────────────────────────────┐   │
│  │ auth.users  │◀────┤        profiles (Primary Identity)              │   │
│  │ (Minimal)   │ 1:1 │  ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │   │
│  │             │     │  │   wallets   │ │user_settings│ │ api_keys  │ │   │
│  └─────────────┘     │  │  (Financial)│ │  (Security) │ │(Program.) │ │   │
│                      │  └─────────────┘ └─────────────┘ └───────────┘ │   │
│                      └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Core Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Self-Custodial Identity** | Users control identity via wallet private keys |
| **Passwordless** | No passwords stored anywhere in the system |
| **Zero-Knowledge** | Server never sees private keys, only signatures |
| **Anti-Replay** | One-time nonces prevent signature replay attacks |
| **Stateless Sessions** | JWT tokens eliminate server-side session storage |
| **Wallet-Agnostic** | Supports any Solana-compatible wallet |

---

## 2. Authentication Flow Deep Dive

### 2.1 Complete Web3 Login Sequence

```
┌──────────┐                              ┌──────────────┐
│  User    │                              │ ProxyHubb    │
│  Browser │                              │   Backend    │
└────┬─────┘                              └──────┬───────┘
     │                                           │
     │  1. Click "Connect Wallet"                │
     │──────────────────────────────────────────▶│
     │                                           │
     │  2. Select Wallet (Phantom, etc.)         │
     │◀──────────────────────────────────────────│
     │                                           │
     │  3. Connect wallet (approve in extension) │
     │──────────────────────────────────────────▶│
     │                                           │
     │  4. POST /auth/wallet/challenge           │
     │     { address: "5x..." }                  │
     │──────────────────────────────────────────▶│
     │                                           │
     │  5. Generate nonce (Redis/Memory)         │
     │     message = "Sign this message..."      │
     │◀──────────────────────────────────────────│
     │                                           │
     │  6. Prompt user to sign message           │
     │     (wallet.signMessage popup)            │
     │◀──────────────────────────────────────────│
     │                                           │
     │  7. User approves signature               │
     │──────────────────────────────────────────▶│
     │                                           │
     │  8. POST /auth/wallet/login               │
     │     { address, signature, nonce }         │
     │──────────────────────────────────────────▶│
     │                                           │
     │  9. Verify Ed25519 signature              │
     │     Check nonce exists (anti-replay)      │
     │     Delete nonce after use                │
     │                                           │
     │  10. Find or Create User                  │
     │      IF wallet exists → return user       │
     │      IF new → create profile + wallet     │
     │                                           │
     │  11. Generate JWT (HS256, 24h expiry)     │
     │◀──────────────────────────────────────────│
     │                                           │
     │  12. Store JWT in localStorage            │
     │     Redirect to /dashboard                │
     │                                           │
```

### 2.2 Authentication State Machine

```
                    ┌─────────────┐
                    │   ANONYMOUS │
                    │   (No JWT)  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌─────────┐  ┌─────────┐  ┌─────────┐
        │ Phantom │  │Solflare │  │ Backpack│
        │ Connect │  │ Connect │  │ Connect │
        └────┬────┘  └────┬────┘  └────┬────┘
             │            │            │
             └────────────┼────────────┘
                          │
                          ▼
                   ┌──────────────┐
                   │  CHALLENGE   │
                   │  (Nonce Gen) │
                   └──────┬───────┘
                          │
                          ▼
                   ┌──────────────┐
                   │   SIGNING    │
                   │ (User Signs) │
                   └──────┬───────┘
                          │
                          ▼
                   ┌──────────────┐
                   │   VERIFIED   │
                   │(JWT Issued)  │◀───────┐
                   └──────┬───────┘        │
                          │                 │
                          ▼                 │
                   ┌──────────────┐        │
                   │ AUTHENTICATED│        │
                   │ (localStorage│        │
                   │  has token)  │────────┘
                   └──────┬───────┘   Refresh
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
       ┌────────────┐          ┌────────────┐
       │   LOGOUT   │          │  JWT EXPIRE│
       │(Clear LS)  │          │ (24 hours) │
       └────────────┘          └────────────┘
```

---

## 3. Database Schema (Decentralized Auth)

### 3.1 Core Identity Tables

#### 3.1.1 auth.users (Minimal Supabase Schema)

```sql
-- Supabase Auth now serves only as a bridge
-- Real identity is the wallet address
CREATE TABLE auth.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255),           -- Synthetic: {wallet}@wallet.proxyhubb.com
    raw_user_meta_data JSONB,     -- Empty for wallet users
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Purpose:** Maintains Supabase compatibility for potential OAuth fallbacks and database constraints.

#### 3.1.2 profiles (Primary Identity Table)

```sql
CREATE TABLE profiles (
    -- Primary Identity (UUID from auth.users)
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Synthetic Email (derived from wallet)
    email VARCHAR(255) NOT NULL,  -- Format: {wallet_address}@wallet.proxyhubb.com
    
    -- CORE WEB3 IDENTITY
    wallet_address VARCHAR(64) UNIQUE,  -- Solana base58 public key
    
    -- Role & Trust
    role VARCHAR(20) DEFAULT 'buyer',      -- buyer, provider, admin
    trust_tier VARCHAR(20) DEFAULT 'new',  -- new, verified, premium
    status VARCHAR(50) DEFAULT 'active',   -- active, suspended, banned
    
    -- Profile Info (Self-sovereign)
    username VARCHAR(50) UNIQUE,
    display_name VARCHAR(100),
    bio TEXT,
    avatar_url TEXT,              -- Can be NFT or IPFS hash
    
    -- Social/Credentials
    verified BOOLEAN DEFAULT FALSE,
    kyc_status VARCHAR(20) DEFAULT 'not_started',
    
    -- Provider Stats
    provider_since TIMESTAMPTZ,
    total_bandwidth_sold NUMERIC DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for Web3 lookups
CREATE UNIQUE INDEX idx_profiles_wallet ON profiles(wallet_address);
CREATE INDEX idx_profiles_email ON profiles(email);
```

**Key Design Decisions:**
- `wallet_address` is the natural key (though UUID is PK for relations)
- Email is synthetic (not user-provided) for compatibility
- No password_hash column exists

### 3.2 Session & Security Tables

#### 3.2.1 user_sessions (Device Tracking)

```sql
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Session Token (Refresh token for JWT rotation)
    refresh_token VARCHAR(255) UNIQUE,
    token_family VARCHAR(64),     -- For detecting token reuse
    
    -- Device Fingerprinting
    ip_address INET NOT NULL,
    user_agent TEXT,
    fingerprint VARCHAR(64),      -- SHA256 of device + browser
    
    -- Geolocation
    country VARCHAR(2),
    city VARCHAR(100),
    
    -- Device Info
    device_type VARCHAR(20),      -- desktop, mobile, tablet
    browser VARCHAR(50),
    os VARCHAR(50),
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    revoked_at TIMESTAMPTZ,
    
    -- Timing
    last_active_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Purpose:** Tracks active sessions for security (view/revoke), not for stateful auth.

### 3.3 Financial Identity

#### 3.3.1 wallets (SOL-Native)

```sql
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Balance (all in SOL)
    balance_sol NUMERIC(20,9) DEFAULT 0,
    
    -- Spending Limits (user-configurable)
    limits_enabled BOOLEAN DEFAULT FALSE,
    daily_limit NUMERIC(20,9) DEFAULT 0,
    weekly_limit NUMERIC(20,9) DEFAULT 0,
    monthly_limit NUMERIC(20,9) DEFAULT 0,
    limit_window_start TIMESTAMPTZ DEFAULT NOW(),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Design:** Wallet is created automatically on first login. Balance ties to on-chain SOL.

---

## 4. Backend Implementation

### 4.1 Authentication Handlers

```go
// File: services/control-api/internal/api/auth.go

// Challenge Generation (Step 1)
func getAuthChallenge(c *gin.Context) {
    var req ChallengeRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
        return
    }

    // Generate cryptographically secure nonce
    bytes := make([]byte, 32)
    rand.Read(bytes)
    nonce := hex.EncodeToString(bytes)
    
    // Message format
    message := "Sign this message to login to ProxyHubb: " + nonce

    // Store in Redis with 5-minute TTL
    key := "auth:nonce:" + req.Address
    redisClient.Set(c, key, message, 5*time.Minute)

    c.JSON(http.StatusOK, gin.H{
        "nonce":   nonce,
        "message": message,
    })
}

// Login Verification (Step 2)
func walletLogin(c *gin.Context) {
    var req LoginRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
        return
    }

    // 1. Retrieve and validate nonce
    storedMsg, err := getAndDeleteNonce(req.Address)
    if err != nil || req.Nonce != storedMsg {
        c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid or expired nonce"})
        return
    }

    // 2. Verify Ed25519 signature
    pubKeyBytes, _ := base58.Decode(req.Address)
    sigBytes, _ := base58.Decode(req.Signature)
    
    if !ed25519.Verify(pubKeyBytes, []byte(req.Nonce), sigBytes) {
        c.JSON(http.StatusUnauthorized, ErrorResponse{Error: "Invalid signature"})
        return
    }

    // 3. Find or create user
    user, err := findOrCreateUserByWallet(req.Address)
    if err != nil {
        c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to create user"})
        return
    }

    // 4. Issue JWT
    token, _ := crypto.GenerateToken(
        user.ID,
        user.Role,
        user.Email,
        req.Address,
        cfg.Auth.JWTSecret,
        24*time.Hour,
    )

    c.JSON(http.StatusOK, gin.H{
        "token": token,
        "user":  user,
    })
}
```

### 4.2 JWT Claims Structure

```go
// File: services/control-api/internal/crypto/jwt.go

type CustomClaims struct {
    UserID string `json:"sub"`           // UUID from profiles
    Role   string `json:"role"`          // buyer, provider, admin
    Email  string `json:"email"`         // Synthetic email
    Wallet string `json:"wallet"`        // Solana address
    jwt.RegisteredClaims
}

// Example decoded JWT:
{
  "sub": "fc431d58-2a64-4e79-a175-12ac4bac8b3d",
  "role": "buyer",
  "email": "9Mrp...Faob2@wallet.proxyhubb.com",
  "wallet": "9MrpHTKd15GfTAcukRSqdfqtUGpEoE4Lj7u7NhdFaob2",
  "exp": 1774024800,
  "iat": 1773938400,
  "iss": "proxyhubb-control-api"
}
```

### 4.3 Middleware Authentication Chain

```go
// File: services/control-api/internal/middleware/supabase.go

func SupabaseAuthMiddleware(cfg *config.Config) gin.HandlerFunc {
    return func(c *gin.Context) {
        tokenString := extractBearerToken(c)
        
        // Priority 1: Local JWT (Web3 Wallet Auth)
        if claims, err := crypto.ValidateToken(tokenString, cfg.Auth.JWTSecret); err == nil {
            c.Set("userID", claims.UserID)
            c.Set("user_id", uuid.MustParse(claims.UserID))
            c.Set("userEmail", claims.Email)
            c.Set("userRole", claims.Role)
            c.Set("walletAddress", claims.Wallet)
            c.Next()
            return
        }
        
        // Priority 2: Provider Token (CLI)
        if providerToken, _ := validateProviderToken(tokenString); providerToken != nil {
            c.Set("userID", providerToken.UserID.String())
            c.Set("user_id", providerToken.UserID)
            c.Set("userRole", "provider")
            c.Next()
            return
        }
        
        // Priority 3: Supabase Token (Legacy/Fallback)
        // ... fallback code
        
        c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
    }
}
```

---

## 5. Frontend Implementation

### 5.1 Auth Context (React)

```typescript
// File: apps/web/src/lib/auth.tsx

export interface AuthContextType {
  user: WalletUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  walletLogin: (address: string, signer: any) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<WalletUser | null>(null);

  // Challenge → Sign → Login flow
  const walletLogin = async (address: string, signer: any) => {
    // 1. Get challenge
    const challengeRes = await fetch('/v1/auth/wallet/challenge', {
      method: 'POST',
      body: JSON.stringify({ address })
    });
    const { message } = await challengeRes.json();

    // 2. Sign with wallet
    const encodedMessage = new TextEncoder().encode(message);
    const signatureBytes = await signer.signMessage(encodedMessage);
    const signature = bs58.encode(signatureBytes);

    // 3. Login
    const loginRes = await fetch('/v1/auth/wallet/login', {
      method: 'POST',
      body: JSON.stringify({ address, signature, nonce: message })
    });
    const { token, user: apiUser } = await loginRes.json();

    // 4. Store JWT
    localStorage.setItem('proxyhubb_token', token);
    setUser(apiUser);
  };

  const logout = async () => {
    localStorage.removeItem('proxyhubb_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, walletLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
```

### 5.2 Wallet Provider Setup

```typescript
// File: apps/web/src/providers/SolanaWalletProvider.tsx

export const SolanaWalletProvider: FC<Props> = ({ children }) => {
    const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
    
    const wallets = useMemo(() => [
        // Phantom is auto-registered as Standard Wallet
        new SolflareWalletAdapter(),
        new TorusWalletAdapter(),
        new LedgerWalletAdapter(),
        new AlphaWalletAdapter(),
    ], []);

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect={false}>
                <WalletModalProvider>
                    {children}
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
};
```

### 5.3 Login Page UI

```typescript
// File: apps/web/src/app/login/page.tsx

export default function LoginPage() {
  const { connected, publicKey, signMessage } = useWallet();
  const { walletLogin } = useAuth();

  const handleWalletLogin = async () => {
    if (!publicKey || !signMessage) return;
    
    await walletLogin(publicKey.toBase58(), { signMessage });
    router.push('/dashboard');
  };

  return (
    <div className="login-container">
      <h2>Connect Wallet</h2>
      
      {/* Wallet Selection */}
      <SolanaWalletButton />
      
      {connected && publicKey && (
        <button onClick={handleWalletLogin}>
          VERIFY IDENTITY ({publicKey.toBase58().slice(0, 4)}...)
        </button>
      )}
      
      {/* Features */}
      <div className="features">
        <span>PHANTOM • SOLFLARE • BACKPACK • ANY SOL WALLET</span>
        <span>NO PASSWORDS • NO EMAILS • SELF-CUSTODIAL</span>
        <span>INSTANT ACCESS • AUTO-REGISTRATION</span>
      </div>
    </div>
  );
}
```

---

## 6. Security Architecture

### 6.1 Threat Model & Mitigations

| Threat | Mitigation |
|--------|------------|
| **Signature Replay** | One-time nonces with 5-minute TTL, deleted after use |
| **JWT Theft** | Short 24h expiry, no refresh tokens (re-authenticate with wallet) |
| **Man-in-the-Middle** | HTTPS only, signature verifies message integrity |
| **Phishing** | Message clearly states "Sign this message to login to ProxyHubb" |
| **Brute Force** | Rate limiting: 10 req/min per IP on auth endpoints |
| **Session Hijacking** | Device fingerprinting, IP tracking in user_sessions table |

### 6.2 Nonce Storage Strategy

```
┌─────────────────────────────────────────────────────────┐
│                  Nonce Storage                          │
├─────────────────────────────────────────────────────────┤
│  Primary: Redis (5-min TTL)                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Key: auth:nonce:{wallet_address}                │   │
│  │ Value: "Sign this message to login...{nonce}"   │   │
│  │ TTL: 300 seconds                                │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Fallback: In-Memory Map (Dev Mode)                     │
│  ┌─────────────────────────────────────────────────┐   │
│  │ map[string]memStoreEntry                        │   │
│  │ expiresAt: time.Now().Add(5min)                 │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 6.3 Signature Verification

```go
// Ed25519 Signature Verification
pubKeyBytes, err := base58.Decode(walletAddress)  // 32 bytes
sigBytes, err := base58.Decode(signature)          // 64 bytes
messageBytes := []byte(message)

// Standard Ed25519 verify
valid := ed25519.Verify(pubKeyBytes, messageBytes, sigBytes)
```

---

## 7. User Account Lifecycle

### 7.1 First-Time User (Auto-Registration)

```
User Connects Wallet
        │
        ▼
┌───────────────────┐
│ Wallet Not Found  │
│ in Database       │
└─────────┬─────────┘
          │
          ▼
┌──────────────────────────┐
│ Transactional Create:    │
│ 1. auth.users entry      │
│ 2. profiles entry        │
│    - wallet_address      │
│    - synthetic email     │
│    - username: user_XXXX │
│    - role: buyer         │
│    - trust_tier: new     │
│ 3. wallets entry         │
│    - zero balance        │
│    - default limits      │
└─────────┬────────────────┘
          │
          ▼
┌───────────────────┐
│ Issue JWT         │
│ Redirect to /dashboard
└───────────────────┘
```

### 7.2 Returning User

```
User Connects Wallet
        │
        ▼
┌───────────────────┐
│ Wallet Found      │
│ Skip creation     │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Issue New JWT     │
│ (24h expiry)      │
└───────────────────┘
```

### 7.3 Account States

| State | Description | Transition |
|-------|-------------|------------|
| `new` | Just created, limited trust | Complete KYC → `verified` |
| `verified` | KYC completed, higher limits | Volume threshold → `premium` |
| `premium` | High-volume user, full access | Violation → `suspended` |
| `suspended` | Temporary restriction | Appeal → `verified` or `banned` |
| `banned` | Permanent restriction | None |

---

## 8. API Endpoints

### 8.1 Authentication Endpoints

| Endpoint | Method | Description | Rate Limit |
|----------|--------|-------------|------------|
| `/v1/auth/wallet/challenge` | POST | Get nonce to sign | 10/min |
| `/v1/auth/wallet/login` | POST | Submit signed message | 10/min |
| `/v1/auth/me` | GET | Get current user profile | 100/min |
| `/v1/auth/dev/login` | POST | Dev login (dev env only) | 10/min |

### 8.2 Request/Response Examples

**Challenge Request:**
```bash
POST /v1/auth/wallet/challenge
Content-Type: application/json

{
  "address": "9MrpHTKd15GfTAcukRSqdfqtUGpEoE4Lj7u7NhdFaob2"
}
```

**Challenge Response:**
```json
{
  "nonce": "a3f7c2d8e5b9140f6a2c8d7e3b5f1a9c4d6e8b2f0a7c5d3",
  "message": "Sign this message to login to ProxyHubb: a3f7c2d8e5b9140f6a2c8d7e3b5f1a9c4d6e8b2f0a7c5d3"
}
```

**Login Request:**
```bash
POST /v1/auth/wallet/login
Content-Type: application/json

{
  "address": "9MrpHTKd15GfTAcukRSqdfqtUGpEoE4Lj7u7NhdFaob2",
  "signature": "5xKj9Np3...Qm8Zr",  // Base58 encoded Ed25519 signature
  "nonce": "Sign this message to login to ProxyHubb: a3f7c2d8..."
}
```

**Login Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "fc431d58-2a64-4e79-a175-12ac4bac8b3d",
    "email": "9MrpHTKd15GfTAcukRSqdfqtUGpEoE4Lj7u7NhdFaob2@wallet.proxyhubb.com",
    "wallet_address": "9MrpHTKd15GfTAcukRSqdfqtUGpEoE4Lj7u7NhdFaob2",
    "role": "buyer",
    "trust_tier": "new",
    "username": "user_9MrpHTKd",
    "created_at": "2026-03-18T06:24:50.399Z"
  }
}
```

---

## 9. Comparison: Traditional vs Decentralized Auth

### 9.1 Architecture Comparison

```
┌────────────────────────────────────────────────────────────────────────┐
│                    TRADITIONAL AUTH (Supabase)                         │
│                                                                        │
│  ┌────────────┐     ┌────────────┐     ┌────────────┐                │
│  │   Email    │────▶│  Password  │────▶│   JWT      │                │
│  │            │     │  (hashed)  │     │  (Session) │                │
│  └────────────┘     └────────────┘     └────────────┘                │
│                                                                        │
│  • Centralized user database                                           │
│  • Password reset via email                                            │
│  • Account recovery through support                                    │
│  • Susceptible to: phishing, password leaks, SIM swap                  │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│                    DECENTRALIZED AUTH (Web3)                           │
│                                                                        │
│  ┌────────────┐     ┌────────────┐     ┌────────────┐                │
│  │   Wallet   │────▶│ Signature  │────▶│   JWT      │                │
│  │  (Public)  │     │ (Ed25519)  │     │ (Stateless)│                │
│  └────────────┘     └────────────┘     └────────────┘                │
│                                                                        │
│  • Self-custodial identity                                             │
│  • Recovery via seed phrase                                            │
│  • No account recovery needed (you own your keys)                      │
│  • Susceptible to: phishing (mitigated by clear signing messages)      │
└────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Data Ownership

| Aspect | Traditional | Decentralized |
|--------|-------------|---------------|
| **Identity** | Owned by platform | Owned by user (wallet) |
| **Credentials** | Stored on server | Never leaves user's device |
| **Recovery** | Email/password reset | Seed phrase backup |
| **Portability** | Locked to platform | Use same wallet anywhere |
| **Privacy** | Email PII required | Pseudonymous (wallet address) |

---

## 10. Deployment & Configuration

### 10.1 Environment Variables

```bash
# Solana Configuration
NEXT_PUBLIC_SOLANA_NETWORK=mainnet  # or devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:8081

# JWT Secret (Backend)
JWT_SECRET=your-super-secret-jwt-signing-key

# Redis (for nonce storage)
REDIS_URL=redis://localhost:6379
```

### 10.2 Database Migration

```sql
-- Migration: Add wallet_address to profiles
ALTER TABLE profiles 
ADD COLUMN wallet_address VARCHAR(64) UNIQUE;

-- Create index for fast wallet lookups
CREATE INDEX idx_profiles_wallet ON profiles(wallet_address);

-- Backfill: Generate synthetic emails for existing users
UPDATE profiles 
SET email = COALESCE(wallet_address, id::text) || '@wallet.proxyhubb.com'
WHERE email IS NULL;
```

---

## 11. Monitoring & Analytics

### 11.1 Key Metrics

| Metric | Description |
|--------|-------------|
| `auth_wallet_login_total` | Total wallet login attempts |
| `auth_wallet_login_success` | Successful logins |
| `auth_wallet_login_failed` | Failed logins (invalid signature) |
| `auth_challenge_generated` | Nonces generated |
| `auth_challenge_expired` | Nonces expired before use |
| `new_user_auto_created` | Auto-registrations |

### 11.2 Security Alerts

Alert triggers:
- >10 failed logins from same IP in 1 minute
- Signature verification failures >50% for an address
- Nonce reuse attempts (indicates replay attack)

---

## 12. Recommendations

### 12.1 Security Enhancements

1. **Multi-Signature Support** - Require multiple wallet signatures for high-value operations
2. **Hardware Wallet Incentives** - Discounts for Ledger/Trezor users
3. **SIWE (Sign-In with Ethereum)** - Future: Support Ethereum wallets
4. **Biometric Integration** - Mobile wallet Face ID/Touch ID

### 12.2 UX Improvements

1. **Persistent Sessions** - Optional "Remember this device" with longer expiry
2. **Session Management UI** - View/revoke active sessions
3. **Wallet Linking** - Link multiple wallets to one account
4. **ENS Integration** - Resolve ENS names for Ethereum compatibility

### 12.3 Compliance

1. **KYC Flow** - Optional identity verification for `verified` tier
2. **Audit Logging** - All auth events logged with IP/device
3. **GDPR Right to Erasure** - Anonymize instead of delete (preserve on-chain records)

---

## 13. Conclusion

The ProxyHubb decentralized authentication system represents a modern, Web3-native approach to user identity:

### Key Achievements

✅ **Fully Passwordless** - No passwords stored anywhere  
✅ **Self-Custodial** - Users own their identity via wallet  
✅ **Wallet Agnostic** - Works with any Solana-compatible wallet  
✅ **Auto-Registration** - Zero-friction onboarding for new users  
✅ **Secure by Design** - Ed25519 signatures, anti-replay nonces, short-lived JWTs  
✅ **Backend Compatible** - Maintains Supabase structure for legacy support  

### Migration Status

| Component | Status |
|-----------|--------|
| Frontend Auth | ✅ Complete |
| Backend API | ✅ Complete |
| Database Schema | ✅ Complete |
| Session Management | ✅ Complete |
| Legacy Supabase Auth | ⚠️ Fallback only |

---

**Document Version:** 2.0  
**Last Updated:** March 19, 2026  
**Author:** ProxyHubb Architecture Team
