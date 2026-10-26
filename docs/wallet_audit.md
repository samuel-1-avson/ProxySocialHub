# ProxyHub — Wallet Deposit & Withdrawal System Audit

> **Audit Date:** 2026-07-02
> **Scope:** Full-stack — Frontend UI, Backend API, On-chain Programs, Database Migrations
> **Severity legend:** 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low
> **Status legend:** ✅ Resolved · 🟡 Partially mitigated / follow-up remains · ⏳ Open

---

## Executive Summary

The ProxyHub custodial wallet system is architecturally sound in its core financial paths. Double-spend protection, SELECT FOR UPDATE locking, on-chain verification before credit, compensating refunds, and a fail-closed velocity guard are all correctly implemented.

This audit originally identified **11 concrete issues** across frontend, backend, database, and on-chain integration layers. As of the 2026-07-02 remediation pass, the codebase has fixes for every listed item. One follow-up remains worth tracking separately: run a broader KMS-readiness sweep for direct oracle key access outside the resolved withdrawal path.

### Current Remediation Snapshot

| Status | Count | Notes |
|---|---:|---|
| ✅ Resolved | 11 | Code or schema now addresses the finding. |
| 🟡 Partially mitigated | 0 | No listed item is currently partial. |
| ⏳ Open | 0 | No listed item is currently unstarted. |

---

## Completed Workstream — Daily Deposit Aggregate Cap

**Goal:** Limit repeated same-day SOL deposits by user, not just individual deposit size.

The implementation now blocks oversized individual deposits through `max_single_deposit_sol` / `MAX_SINGLE_DEPOSIT_SOL` and repeated same-day deposits through `max_daily_deposit_sol` / `MAX_DAILY_DEPOSIT_SOL`.

### Backend Shape

| Item | Behavior |
|---|---|
| Config key | `max_daily_deposit_sol` with env fallback `MAX_DAILY_DEPOSIT_SOL` |
| Default | `50000` SOL until product/ops choose a production-specific ceiling |
| Source of truth | Sum completed `wallet_ledger_entries` for the user's wallet where `type = 'deposit'` and `created_at >= now() - interval '24 hours'` |
| Enforcement point | `verifyCryptoDeposit`, after on-chain amount verification and before crediting the wallet |
| Race safety | The wallet row is locked with `FOR UPDATE`; aggregate check and ledger write happen inside the same DB transaction |
| Response | HTTP 429 with `max_sol`, `used_sol`, and `remaining_sol` fields |

### Verification

- A deposit that keeps the user under the rolling 24-hour cap succeeds.
- A deposit that would push the user over the rolling 24-hour cap fails before wallet balance mutation.
- The failed over-cap request does not create a pending transaction or ledger entry.
- The check uses the verified on-chain amount, not only the client-provided amount.
- Unit/API tests cover single-deposit cap rejection, daily aggregate rejection, and a successful deposit below the cap.

### Notes Before Implementation

- The aggregate limit should be separate from withdrawal spending limits. Deposits increase platform custodial exposure, while spending limits control outflow or internal spend.
- If product later wants tiered deposit caps, the same trust-tier model used for spending limits can be reused.
- If the ledger query becomes hot, add a partial index on `(wallet_id, created_at)` where `type = 'deposit'`.

---

## Audit Findings

### ✅ 🔴 CRITICAL-1 — KMS/HSM Key Inconsistency in `SendSOL`

| Field | Value |
|---|---|
| **File** | `services/control-api/internal/solana/settlement.go` (~line 470) |
| **Area** | Backend / On-chain |

**Problem:** `SendSOL` uses `c.oracleKey.PublicKey()` directly, while `BatchTransferSOL` correctly uses `c.GetOraclePublicKey()` which routes through HSM/KMS when configured. When AWS KMS is active, `c.oracleKey` is `nil` (only set in the non-KMS path, per `client.go` lines 160–166). This means **every SOL withdrawal will panic/fail with a nil-pointer dereference when KMS is enabled in production**.

**Resolution:** `SendSOL` now uses `c.GetOraclePublicKey()` for the transfer signer account, matching the KMS-aware path used by batch transfers.

**Follow-up note:** A targeted grep still shows direct `c.oracleKey.PublicKey()` usage in several non-withdrawal Solana instruction builders. This finding is resolved for `SendSOL`, but a broader KMS-readiness pass should verify every path that may run with AWS KMS enabled.

---

### ✅ 🔴 CRITICAL-2 — No Per-User Deposit Rate Limit (Amount Cap)

| Field | Value |
|---|---|
| **File** | `services/control-api/internal/api/crypto.go` — `verifyCryptoDeposit` |
| **Area** | Backend |

**Problem:** There is no maximum per-deposit or per-day deposit SOL cap. Any user can verify an arbitrarily large SOL transaction (one massive whale deposit or a deliberately crafted transaction), crediting an enormous platform balance. Combined with any future withdrawal bug, this is the highest-risk attack surface. The `req.Amount` field has only a `gt=0` binding tag — no upper bound.

**Resolution:** `cryptoDepositRequest.Amount` now has `lte=100000`, and `verifyCryptoDeposit` enforces a runtime `max_single_deposit_sol`/`MAX_SINGLE_DEPOSIT_SOL` cap against both the requested and verified on-chain amount. It also enforces a rolling 24-hour per-user deposit aggregate cap through `max_daily_deposit_sol`/`MAX_DAILY_DEPOSIT_SOL`, using the verified on-chain amount before wallet balance mutation.

---

### ✅ 🟠 HIGH-1 — New Wallets Default to `limits_enabled = false`

| Field | Value |
|---|---|
| **File** | `migrations/000048_wallet_limits_enabled.up.sql` + `wallet.go` `CheckSpendingLimit` |
| **Area** | Database / Backend |

**Problem:** The migration adds a `limits_enabled BOOLEAN DEFAULT false` column to wallets. The `CheckSpendingLimit` method honours this flag — if false, **all amounts pass regardless of limit values**. Every newly created wallet has spending limits disabled until an admin explicitly enables them, leaving an unguarded withdrawal window for new users.

**Resolution:** `migrations/000102_wallet_security_remediation.up.sql` changes the DB default to `true`, and wallet creation paths call `InitializeWithDefaultLimits(...)`.

---

### ✅ 🟠 HIGH-2 — No Cooldown or Confirmation UI Before On-Chain Deposit Transfer

| Field | Value |
|---|---|
| **File** | `apps/web/src/app/dashboard/wallet/page.tsx` — `handleDepositSol` |
| **Area** | Frontend |

**Problem:** When a user clicks "Deposit SOL", the wallet adapter `sendTransaction` is called immediately with no confirmation dialog. The user sees a pending banner colored green ("Approve the transfer in your wallet…"), which is semantically misleading. There is no step confirming: *"You are about to send X SOL to [address]. Are you sure?"*

**Resolution:** The wallet page now routes deposit clicks through a confirmation dialog showing amount, network, and treasury destination before calling the wallet adapter. The wallet-approval state uses the `info` result type.

---

### ✅ 🟠 HIGH-3 — Wallet Fetch Error State Silently Falls Through

| Field | Value |
|---|---|
| **File** | `apps/web/src/app/dashboard/wallet/page.tsx` lines ~100–130 |
| **Area** | Frontend |

**Problem:** `const { data: wallet, isLoading } = useQuery(...)`. The `error` return value is **never consumed**. If the wallet fetch fails (network error, token expiry, backend down), the UI renders silently with `balance_sol = 0.0000 SOL` and `~$0.00`, with no error banner or retry prompt. Users cannot distinguish a real zero balance from a fetch failure.

**Resolution:** The wallet query now consumes `error: walletError` and renders an error banner instead of silently showing an apparent zero balance.

---

### ✅ 🟡 MEDIUM-1 — `uuid.MustParse` Panic Path in Deposit Handler

| Field | Value |
|---|---|
| **File** | `services/control-api/internal/api/crypto.go` line 436 |
| **Area** | Backend |

**Problem:** `uuid.MustParse(userID)` panics if `userID` from context is not a valid UUID. While a deferred recover prevents a server crash, the panic produces an unhelpful 500 with no diagnostic message.

**Resolution:** The deposit handler now uses `GetUserID(c)` as a typed UUID source and no longer needs `uuid.MustParse` for wallet creation.

---

### ✅ 🟡 MEDIUM-2 — Transaction Ledger Displays SOL to 2 Decimal Places

| Field | Value |
|---|---|
| **File** | `apps/web/src/app/dashboard/wallet/page.tsx` — transaction rendering |
| **Area** | Frontend |

**Problem:** `Number(tx.amount || 0).toFixed(2)` — amounts in the ledger are truncated to 2 decimal places. For small SOL amounts (e.g., `0.00015 SOL`), this displays as `0.00 SOL`, making the ledger useless for micro-transactions which are common in proxy/session payments.

**Resolution:** Ledger rendering uses `formatSOL(...)`, displaying up to 6 decimals for small SOL amounts.

---

### ✅ 🟡 MEDIUM-3 — Hardcoded SOL Price Fallback ($150) Displayed Without Warning

| Field | Value |
|---|---|
| **File** | `apps/web/src/app/dashboard/wallet/page.tsx` line 65 |
| **Area** | Frontend |

**Problem:** `const [solPriceUSD, setSolPriceUSD] = useState<number>(150)`. If the system config fetch is slow or fails, the USD equivalent shown to users is computed from a hardcoded `$150/SOL` price with no visual indicator that the price is stale or estimated. `sol_price_usd` is also untyped in `SystemConfig` (accessed via `[key: string]: any`).

**Resolution:** `solPriceUSD` now initializes to `null`, the UI shows a price-unavailable state, and `SystemConfig` includes typed `sol_price_usd`.

---

### ✅ 🟡 MEDIUM-4 — Cooldown Status Not Shown on OVERVIEW Tab (Withdrawal Tab)

| Field | Value |
|---|---|
| **File** | `apps/web/src/app/dashboard/wallet/page.tsx` — OVERVIEW tab |
| **Area** | Frontend |

**Problem:** `withdrawal_cooldown_active` and `withdrawal_cooldown_until` are surfaced only in the LINKED_WALLETS tab. The "Withdraw SOL" button is on the OVERVIEW tab. A user with an active cooldown will press Withdraw, fill in the form, and only learn about the cooldown from the backend error response — a bad UX flow.

**Resolution:** Withdrawal security data is fetched on page load, and the OVERVIEW withdrawal panel now shows an inline cooldown warning near the withdraw action.

---

### ✅ 🟡 MEDIUM-5 — `LARGE_WITHDRAW_SOL` and Fee Buffer Hardcoded in Frontend

| Field | Value |
|---|---|
| **File** | `apps/web/src/app/dashboard/wallet/page.tsx` lines 59, 266 |
| **Area** | Frontend |

**Problem:** `LARGE_WITHDRAW_SOL = 10` (the threshold requiring extra signature) and `feeBuffer = 10_000 lamports` (on-chain balance check for deposit eligibility) are both hardcoded in the UI. If the backend threshold is changed via config, the frontend will incorrectly request or omit the signature step.

**Resolution:** `/v1/system/config/public` now exposes `large_withdraw_threshold_sol`, the backend withdrawal enforcement uses the same config value, and the frontend consumes it with a 10 SOL fallback. The deposit balance preflight now uses a conservative `50_000` lamport fee buffer.

---

### ✅ 🟡 MEDIUM-6 — Auto-Release Escrow Failure Is Logged But Not Alerted

| Field | Value |
|---|---|
| **File** | `services/control-api/internal/api/escrow.go` lines 443–444 |
| **Area** | Backend |

**Problem:** When the on-chain settlement fails during auto-release of an expired escrow, the system only calls `log.Printf(...)` and `continue`s to the next escrow. If the oracle is persistently down, sellers will silently not receive their funds for extended periods without any ops alert.

**Resolution:** The auto-release on-chain settlement failure path now sends an `alerts.Warning` notification with order, escrow, and error context. The alert package currently supports `Info`, `Warning`, and `Critical`.

---

## What Is Working Well ✅

| Area | Status |
|---|---|
| Rate limiting on all financial endpoints (5 req/min) | ✅ Correctly applied |
| Double-spend protection (idempotency key + unique DB index) | ✅ Strong |
| SELECT FOR UPDATE on wallet row during withdrawal | ✅ Prevents race-condition over-withdrawal |
| Dual-wallet deadlock-safe locking in P2P transfer | ✅ UUID-lexicographic order |
| On-chain verification at CommitmentFinalized before credit | ✅ Only finalized txns credited |
| Compensating refund on withdrawal on-chain failure | ✅ DB restored atomically |
| Velocity guard (fail-closed, Redis down = blocked) | ✅ Correctly fail-closed |
| 24-hour withdrawal address change cooldown | ✅ DB-enforced |
| Large withdrawal Ed25519 signature + 5-min nonce window | ✅ Redis SETNX replay protection |
| Whitelist address validation (base58 + max 20 entries) | ✅ Backend enforced |
| User freeze/flag check before withdrawal | ✅ `user_flags` query |
| Compensating refund critical alert if refund itself fails | ✅ Ops notification |
| P2P goroutine panic recovery with rollback | ✅ No silent state corruption |
| Escrow SKIP LOCKED prevents cron double-release | ✅ Safe concurrent batch |

---

## Remediation Log

| # | Fix | Status | Evidence |
|---|---|---|---|
| 1.1 | KMS `SendSOL` key path | ✅ Resolved | `SendSOL` uses `GetOraclePublicKey()`. |
| 1.2 | Deposit amount upper bound | ✅ Resolved | Request binding plus runtime `max_single_deposit_sol` / `MAX_SINGLE_DEPOSIT_SOL` cap and rolling `max_daily_deposit_sol` / `MAX_DAILY_DEPOSIT_SOL` cap. |
| 2.1 | `limits_enabled` default to true | ✅ Resolved | Migration `000102_wallet_security_remediation` and wallet default initialization. |
| 2.2 | Deposit confirmation dialog | ✅ Resolved | Wallet page renders `showDepositConfirm` modal before sending SOL. |
| 2.3 | Wallet fetch error state | ✅ Resolved | Wallet query consumes `walletError` and renders an error banner. |
| 3.1 | `uuid.MustParse` panic path | ✅ Resolved | Deposit handler uses typed UUID from `GetUserID(c)`. |
| 3.2 | Ledger SOL display precision | ✅ Resolved | Ledger amount rendering uses `formatSOL(...)`. |
| 3.3 | SOL price null state + types | ✅ Resolved | UI initializes SOL price to `null`; `SystemConfig` types `sol_price_usd`. |
| 3.4 | Cooldown warning on OVERVIEW | ✅ Resolved | Withdrawal panel renders active cooldown warning near the action. |
| 3.5 | Large withdrawal threshold / fee buffer | ✅ Resolved | Backend exposes and enforces `large_withdraw_threshold_sol`; UI consumes it and uses a 50,000 lamport buffer. |
| 3.6 | Escrow auto-release alert | ✅ Resolved | Auto-release settlement failures send `alerts.Warning`. |

## Remaining Follow-Up

Run a broader KMS-readiness sweep for direct `oracleKey.PublicKey()` usage outside `SendSOL` and `BatchTransferSOL`.

---

## Historical Implementation Plan (Superseded)

### Phase 1 — Critical Fixes (Do Before Any Production Deployment)

#### Fix 1.1 — `SendSOL` KMS Key Path
**File:** `services/control-api/internal/solana/settlement.go`

Replace:
```go
// Before
c.oracleKey.PublicKey()
```
With:
```go
// After
c.GetOraclePublicKey()
```

#### Fix 1.2 — Deposit Amount Upper Bound
**File:** `services/control-api/internal/api/crypto.go`

Add to binding tag and runtime check:
```go
type cryptoDepositRequest struct {
    TxHash string  `json:"tx_hash" binding:"required"`
    Amount float64 `json:"amount"  binding:"required,gt=0,lte=100000"` // Add lte=100000
    Chain  string  `json:"chain"   binding:"required"`
}
```

And add a configurable ENV check at handler start:
```go
maxDeposit := config.GetFloat64("MAX_SINGLE_DEPOSIT_SOL", 10000.0)
if req.Amount > maxDeposit {
    return c.JSON(http.StatusBadRequest, gin.H{"error": "Deposit exceeds maximum allowed amount"})
}
```

### Phase 2 — High Priority Fixes

#### Fix 2.1 — Default `limits_enabled = true`
**New migration file:** `000090_wallet_limits_default_enabled.up.sql`
```sql
ALTER TABLE wallets ALTER COLUMN limits_enabled SET DEFAULT true;
UPDATE wallets SET limits_enabled = true WHERE limits_enabled = false AND daily_limit = 0 AND weekly_limit = 0 AND monthly_limit = 0;
```
And update wallet creation code to always set `limits_enabled = true` + seed default limits.

#### Fix 2.2 — Deposit Confirmation Dialog
**File:** `apps/web/src/app/dashboard/wallet/page.tsx`
- Add a `showDepositConfirm` boolean state.
- When user clicks "Deposit SOL", set `showDepositConfirm = true` instead of calling `sendTransaction`.
- Render a modal showing: amount, destination treasury address, estimated fee, network.
- "Confirm" button calls `sendTransaction`. "Cancel" resets state.
- Change "Approve the transfer in your wallet…" banner color to amber/info.

#### Fix 2.3 — Wallet Fetch Error State
**File:** `apps/web/src/app/dashboard/wallet/page.tsx`
```tsx
const { data: wallet, isLoading, error: walletError } = useQuery(...)

// In render:
{walletError && (
  <div className="error-banner">
    Unable to load wallet data. <button onClick={() => refetch()}>Retry</button>
  </div>
)}
```

### Phase 3 — Medium Priority Fixes

#### Fix 3.1 — `uuid.MustParse` → `uuid.Parse`
**File:** `services/control-api/internal/api/crypto.go` line 436
```go
userUUID, err := uuid.Parse(userID)
if err != nil {
    log.Printf("verifyCryptoDeposit: invalid userID UUID %q: %v", userID, err)
    return c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal error"})
}
wallet = models.Wallet{UserID: userUUID, ...}
```

#### Fix 3.2 — Transaction Ledger SOL Precision
**File:** `apps/web/src/app/dashboard/wallet/page.tsx`
```tsx
// Replace toFixed(2) with a smart formatter:
function formatSOL(n: number): string {
  if (n === 0) return '0';
  if (Math.abs(n) >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}
// Usage: {formatSOL(Number(tx.amount || 0))} SOL
```

#### Fix 3.3 — SOL Price Null State + Type Safety
**File:** `apps/web/src/app/dashboard/wallet/page.tsx` + `apps/web/src/lib/api/config.ts`

In page.tsx:
```tsx
const [solPriceUSD, setSolPriceUSD] = useState<number | null>(null);

// Display:
{solPriceUSD !== null
  ? `~$${(balance * solPriceUSD).toFixed(2)}`
  : 'Price unavailable'}
```

In SystemConfig type:
```ts
export interface SystemConfig {
  treasury_solana: string;
  sol_price_usd: number;
  large_withdraw_threshold_sol?: number;
  [key: string]: unknown; // tighter than any
}
```

#### Fix 3.4 — Cooldown Warning on OVERVIEW Tab
**File:** `apps/web/src/app/dashboard/wallet/page.tsx`
- `getWithdrawalSecurity()` is already defined in `wallet.ts` — add a second `useQuery` for it on page load.
- If `security?.withdrawal_cooldown_active`, render a banner above the Withdraw form:
  ```tsx
  <div className="warning-banner">
    ⏳ Withdrawal cooldown active until {formatDate(security.withdrawal_cooldown_until)}.
    You recently changed your withdrawal address.
  </div>
  ```

#### Fix 3.5 — `LARGE_WITHDRAW_SOL` From Config
**File:** `apps/web/src/app/dashboard/wallet/page.tsx`
- Remove `const LARGE_WITHDRAW_SOL = 10` constant.
- Use `treasuryConfig?.large_withdraw_threshold_sol ?? 10` in the check.
- Add `large_withdraw_threshold_sol: number` to `SystemConfig` type.
- Backend: expose this value via `/v1/system/config/public`.

#### Fix 3.6 — Escrow Auto-Release Alert on On-Chain Failure
**File:** `services/control-api/internal/api/escrow.go` lines 443–444

```go
// Before:
log.Printf("AutoReleaseExpiredEscrows on-chain settlement failed for escrow %s: %v", escrow.ID, err)
continue

// After:
log.Printf("AutoReleaseExpiredEscrows on-chain settlement failed for escrow %s: %v", escrow.ID, err)
alerts.Send(alerts.High, fmt.Sprintf("AutoRelease: on-chain settlement failed for escrow %s", escrow.ID), err.Error())
continue
```

---

## Historical Fix Priority Matrix (Superseded)

| # | Fix | Severity | Effort | Phase |
|---|---|---|---|---|
| 1.1 | KMS `SendSOL` key path | 🔴 Critical | 5 min | 1 |
| 1.2 | Deposit amount upper bound | 🔴 Critical | 30 min | 1 |
| 2.1 | `limits_enabled` default to true | 🟠 High | 1 hr | 2 |
| 2.2 | Deposit confirmation dialog | 🟠 High | 2 hr | 2 |
| 2.3 | Wallet fetch error state | 🟠 High | 30 min | 2 |
| 3.1 | `uuid.MustParse` → `uuid.Parse` | 🟡 Medium | 15 min | 3 |
| 3.2 | Ledger SOL display precision | 🟡 Medium | 20 min | 3 |
| 3.3 | SOL price null state + types | 🟡 Medium | 30 min | 3 |
| 3.4 | Cooldown warning on OVERVIEW | 🟡 Medium | 1 hr | 3 |
| 3.5 | `LARGE_WITHDRAW_SOL` from config | 🟡 Medium | 45 min | 3 |
| 3.6 | Escrow auto-release alert | 🟡 Medium | 15 min | 3 |

**Total estimated effort: ~7 hours**
