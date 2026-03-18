# ProxyHubb Frontend Analysis Report
**Date**: 2026-03-17
**Scope**: Full frontend codebase — `apps/web/src/`
**Analyst**: Claude Code (Frontend Architecture Review)
**Stack**: Next.js 16.1.1 · React 19 · TailwindCSS v4 · TypeScript · Solana Web3.js · TanStack Query v5 · Zustand · Framer Motion

---

## Overall Rating

| Dimension | Score | Verdict |
|---|---|---|
| **Architecture** | 6.5 / 10 | Good foundation, needs structural tightening |
| **UX / Design** | 6 / 10 | Strong aesthetic, poor interaction patterns |
| **Code Quality** | 5.5 / 10 | Inconsistent; critical bugs present |
| **Type Safety** | 5 / 10 | TypeScript present but undermined |
| **Performance** | 6 / 10 | Good caching, missing virtualisation |
| **Error Handling** | 4.5 / 10 | Incomplete; `alert()` antipatterns |
| **Accessibility** | 3.5 / 10 | Minimal; skip link exists, no ARIA |
| **Testing** | 2 / 10 | Playwright configured, no test files found |
| **Overall** | **5 / 10** | Functional but not production-ready |

---

## Executive Summary

The ProxyHubb frontend is a **technically ambitious** Next.js 16 application that correctly integrates Solana wallet signing, L2 state channels, real-time WebSocket feeds, and a full marketplace purchase flow. The cyberpunk glassmorphism aesthetic is consistent and visually compelling.

However, the codebase carries **serious production risks**: critical route bugs that break purchase flows, `alert()` calls blocking the browser thread, a near-complete absence of automated tests, type safety systematically undermined by `| string` overuse, and no accessibility strategy. The architecture is layered correctly (API → Services → Queries → UI) but is not enforced — several pages bypass the service layer entirely and call raw API functions from inside `useEffect` callbacks.

**The frontend needs a focused remediation pass before any public launch.**

---

## 1. Architecture Analysis

### 1.1 Directory Structure

```
apps/web/src/
├── app/                   # Next.js App Router (pages + API routes)
│   ├── dashboard/         # Consumer hub — 12 sub-routes
│   │   └── provider/      # Provider portal — 7 sub-routes
│   ├── explorer/          # Network telemetry — 9 sub-routes
│   ├── marketplace/       # Listing marketplace + [id] detail
│   ├── agents/            # AI agent marketplace
│   ├── forum/             # Community forum
│   ├── governance/        # DAO voting
│   ├── messages/          # Direct messaging
│   ├── feed/              # Social feed
│   └── api/               # Next.js API routes (proxy/test, sessions/stream)
├── components/            # 30+ UI components
│   └── ui/                # Primitive components (glass-card, skeleton)
├── lib/
│   ├── api/               # 19 HTTP client modules
│   ├── services/          # 17 business logic modules
│   ├── hooks/             # Custom React hooks
│   ├── store/             # Zustand stores
│   ├── auth/              # Supabase SSR auth
│   ├── solana/            # Solana Web3.js wrappers
│   └── utils/             # Formatting, validation helpers
├── providers/             # React context providers
└── stores/                # Zustand state slices
```

### 1.2 What Works Well

- **App Router adoption** is correct — server components where applicable, `"use client"` only where needed
- **API/Service separation** exists (`lib/api/` for HTTP, `lib/services/` for business logic)
- **React Query** is used correctly for server state (caching, background refresh, deduplication)
- **Zustand** correctly manages client-only UI state (sidebar, theme, modals)
- **Provider nesting** is sensible: ThemeProvider → QueryProvider → SolanaWalletProvider → AuthProvider

### 1.3 Architectural Weaknesses

#### A. No Route Grouping Convention
Dashboard has 20+ sub-routes but no route group layout organisation. Every page re-imports the same data-fetching hooks independently. A `(consumer)/` and `(provider)/` route group would share layouts and reduce duplication.

#### B. Service Layer Bypass
Many pages (`/dashboard/analytics/page.tsx`, `/dashboard/proxy/page.tsx`) call `lib/api/*` functions directly from `useEffect`, bypassing `lib/services/`. This creates two code paths for the same data — changes must be made in both places.

#### C. Inconsistent Data Fetching
Three patterns are used for the same type of problem:
1. `useEffect` + `useState` (manual loading/error flags) — most dashboard pages
2. `useQuery` from TanStack (correct) — explorer pages
3. `useSWR` nowhere, but React Query not universally applied

All server-state fetching should go through React Query. `useEffect` data fetching is the anti-pattern it replaces.

#### D. No Shared Layout Data
The sidebar, user profile, and wallet balance are each fetched independently on almost every page. A root layout-level query or context would fetch these once.

---

## 2. Page Inventory & Route Map

| Route | Auth | Real API | Issues |
|---|---|---|---|
| `/` | No | No | Landing page |
| `/login` | No | ✅ | — |
| `/register` | No | ✅ | — |
| `/dashboard` | ✅ | ✅ | Good |
| `/dashboard/wallet` | ✅ | ✅ | `alert()` on error; `setInterval` race |
| `/dashboard/proxy` | ✅ | ✅ | Hardcoded endpoint |
| `/dashboard/nodes` | ✅ | ✅ | Defaults trust score to 85 |
| `/dashboard/analytics` | ✅ | ✅ | Hardcoded `₵` currency |
| `/dashboard/sessions` | ✅ | ✅ | — |
| `/dashboard/earnings` | ✅ | ✅ | — |
| `/dashboard/provider/*` | ✅ | ✅ | — |
| `/marketplace` | No | ✅ | — |
| `/marketplace/[id]` | No | ✅ | **Bug: redirects to `/dashboard/proxies`** |
| `/explorer` | No | ✅ | 6 simultaneous polling queries |
| `/explorer/nodes` | No | ✅ | — |
| `/explorer/transactions` | No | ✅ | No virtualisation |
| `/explorer/wallets/[address]` | No | ✅ | — |
| `/explorer/blocks/[number]` | No | ✅ | — |
| `/explorer/map` | No | ✅ | GeoIP DB not bundled |
| `/agents` | No | ✅ | `alert()` for rent success/failure |
| `/forum` | No | Partial | Minimal implementation |
| `/governance` | No | Partial | Voting not fully wired |
| `/messages` | ✅ | Partial | Real-time status unknown |
| `/feed` | ✅ | Partial | Real-time status unknown |
| `/profile/[username]` | No | ✅ | — |

---

## 3. Component Analysis

### 3.1 Component Inventory (30+ components)

**Navigation**: `Sidebar.tsx`, `Navbar.tsx`, `Breadcrumbs.tsx`
**Auth/Security**: `ProtectedRoute.tsx`, `WalletConnect.tsx`, `SolanaWalletButton.tsx`
**Marketplace**: `BuyListingModal.tsx`, `ListingCard.tsx`
**Sessions**: `StreamingSessionCard.tsx`, `SessionLiveCard.tsx`
**Provider**: `ProviderSetupGuide.tsx`, `ProviderScoreCard.tsx`, `ProviderTierBadge.tsx`, `ProviderShowcase.tsx`
**Explorer**: `NetworkFeed.tsx`, `PerformanceHeatmap.tsx`
**Social**: `FriendButton.tsx`, `PeopleYouMayKnow.tsx`
**UX**: `Toast.tsx`, `ErrorBoundary.tsx`, `ModeToggle.tsx`, `SmartMatchWidget.tsx`
**UI Primitives**: `glass-card.tsx`, `skeleton.tsx` (shadcn-style)

### 3.2 Component-Level Issues

**`StreamingSessionCard.tsx`** — updates every **100ms** via `setInterval`. On a page with 5 active sessions this fires 50 React state updates per second. Should use `requestAnimationFrame` or a 1-second interval; the visible precision doesn't justify 100ms.

**`BuyListingModal.tsx`** — the purchase flow is correct (order → escrow → session → credentials) but no transaction signature verification is shown to the user, and the error state shows no actionable detail (e.g. "insufficient balance" vs "network timeout").

**`Sidebar.tsx`** — menu structure is hardcoded. New routes require code changes. Should be driven by a config array or a permissions-based menu service.

---

## 4. API & Service Layer

### 4.1 API Modules (19 files in `lib/api/`)

| Module | Purpose | Quality |
|---|---|---|
| `client.ts` | Base HTTP + auth | Good — retry logic, error normalisation |
| `wallet.ts` | Wallet CRUD | Good |
| `marketplace.ts` | Listings + orders | Good |
| `sessions.ts` | Proxy sessions | Good |
| `analytics.ts` | Usage metrics | Good |
| `provider.ts` | Provider ops | Good |
| `agents.ts` | AI agents | Minimal |
| `governance.ts` | DAO | Stub-level |
| `social.ts` | Feed, messaging | Stub-level |
| `channels.ts` | L2 state channels | Good but undocumented |
| `matching.ts` | Smart matching | Good |
| `subscriptions.ts` | Subscriptions | Good |
| `referral.ts` | Referrals | Minimal |
| `monitoring.ts` | Metrics | Minimal |
| `circles.ts` | Groups | Minimal |

### 4.2 Auth Pattern
```typescript
// client.ts — correct pattern
const token = await supabase.auth.getSession();
headers['Authorization'] = `Bearer ${token.access_token}`;
```

### 4.3 Error Handling in API Layer
The base client normalises HTTP errors correctly. The problem is upstream — callers catch errors and either log silently or show `alert()`:

```typescript
// ❌ Current — silent failure
catch (e) { console.error(e); }

// ❌ Current — blocks browser
catch (e) { alert("Failed: " + e.message); }

// ✅ Target
catch (e) { toast.error(getErrorMessage(e)); }
```

---

## 5. State Management

### 5.1 Server State — React Query

**Config** (QueryProvider.tsx):
- Stale time: 5 minutes
- Cache time: 30 minutes
- Retry: 3× on 5xx, 0× on 4xx
- Backoff: 1s → 2s → 4s (max 30s)

**Problem**: Explorer uses 6 simultaneous `refetchInterval` queries:

| Query | Interval |
|---|---|
| metrics | 10s |
| recent-transactions | 5s |
| recent-blocks | 5s |
| network-health | 30s |
| top-nodes | 60s |
| analytics-dashboard | 120s |

The 5-second queries fire 12 requests/minute. On a slow connection or limited API rate, this causes visible lag and unnecessary backend load. WebSocket should replace polled queries.

### 5.2 Client State — Zustand

Zustand is used correctly for UI state (sidebar collapse, active modal, theme). No issues.

### 5.3 Mixed Pattern Problem

Dashboard pages use `useEffect` + manual `useState` instead of `useQuery`. This means:
- No deduplication — two components requesting same data each get their own fetch
- No background revalidation
- Manual `isLoading` / `error` state required in every component
- No devtools visibility

---

## 6. TypeScript Audit

### 6.1 Strengths
- All API response types are defined (Wallet, Session, Listing, etc.)
- `ProxyCredentials`, `Order`, `Transaction` interfaces are complete
- Optional chaining (`?.`) used consistently
- Type guards used before array operations

### 6.2 Critical Weaknesses

**`| string` union type defeat** — used throughout to handle unknown values:
```typescript
// ❌ Defeats purpose of the union
type: 'deposit' | 'withdrawal' | 'purchase' | string
status?: 'pending' | 'completed' | 'failed' | string

// ✅ Correct
type: 'deposit' | 'withdrawal' | 'purchase' | 'earning' | 'refund'
status?: 'pending' | 'completed' | 'failed'
```

**`any` in catch blocks**:
```typescript
// ❌ Current
catch (err: any) { setError(err.message); }

// ✅ Target
catch (err: unknown) {
  const message = err instanceof Error ? err.message : 'Unknown error';
  setError(message);
}
```

**Missing `satisfies` on config objects**:
```typescript
// Large config objects like stats arrays use `any[]` implicitly
const stats = [...];  // Should be `const stats: StatConfig[] = [...]`
```

---

## 7. UX & Design Analysis

### 7.1 Design System

- **Aesthetic**: Cyberpunk retro with glassmorphism — consistent and distinctive
- **Colours**: Emerald-400 primary, dark backgrounds (#0a0a0f), subtle borders (`border-white/5`)
- **Typography**: Monospace fonts for values and IDs; sans-serif for labels
- **Motion**: Framer Motion used consistently for card entrances, hover effects
- **Icons**: Lucide React (consistent weight)

**Rating: 7.5/10** — Visually strong, unique identity

### 7.2 UX Problems

#### CRITICAL — Blocking `alert()` Calls
Found in 4+ files. `alert()` freezes the browser tab and provides no styling, no stack trace, and no dismiss animation.

```
agents/page.tsx       → alert() on rent success AND failure
dashboard/wallet/     → alert() on link/unlink wallet
marketplace/[id]/     → no toast on success
```

#### HIGH — No Global Toast System in Use
`Toast.tsx` component exists but is not wired to API error callbacks. Every error is either silently swallowed or `alert()`'d.

#### HIGH — Broken Purchase Redirect
```typescript
// marketplace/[id]/page.tsx
router.push('/dashboard/proxies');  // ❌ Route does not exist → 404
// Should be:
router.push('/dashboard/proxy');    // ✅
```

#### HIGH — No Optimistic UI
Purchase flow, session creation, and node registration all block on full server round-trip with a spinner. No optimistic updates means perceived latency is 2–5× higher than necessary.

#### MEDIUM — Form Validation Gaps
Bandwidth slider has min/max validation but no visual feedback when value is out of range. Wallet link form accepts any string as a Solana address before the API call.

#### MEDIUM — Empty States Inconsistent
Some pages have designed empty states (nodes, agents). Others show blank space or a spinner that never resolves if API returns empty array.

#### MEDIUM — Currency Inconsistency
```
Dashboard: SOL + USD equivalent ✅
Analytics: ₵ (Cedi symbol) hardcoded in some charts ❌
Marketplace: SOL price, no fiat equivalent ⚠️
```

#### LOW — No Confirmation on Destructive Actions
Terminating a proxy session has no confirmation dialog. Users can accidentally end paid sessions.

### 7.3 Accessibility

- ✅ Skip navigation link exists (`Accessibility.tsx`)
- ❌ No `aria-label` on icon-only buttons (sidebar, close buttons)
- ❌ No keyboard navigation for modal dialogs
- ❌ No focus trap in modals
- ❌ No `role="status"` on loading states
- ❌ Colour contrast: emerald-400 on dark backgrounds passes WCAG AA for large text only
- ❌ Framer Motion animations — no `prefers-reduced-motion` check

---

## 8. Performance Analysis

### 8.1 Positives
- React Query caching eliminates redundant API calls
- Next.js automatic code splitting by route
- `Loader2` spinner while loading prevents layout shift
- Framer Motion `layoutId` animations are GPU-accelerated

### 8.2 Issues

**`setInterval(100ms)` in StreamingSessionCard**
At 5 active sessions: 50 state updates/second → 50 React re-renders/second.
Each renders a card with cost calculation, timers, and data counters.
Fix: use `requestAnimationFrame` or 1000ms interval.

**No list virtualisation**
Explorer transaction feed, marketplace listings, and node grids render all items into the DOM. At 100+ items this causes:
- Slow initial paint
- Jank during scroll
- High memory usage
Fix: `@tanstack/react-virtual` or `react-window`.

**6 simultaneous polling queries on Explorer**
Should be replaced with a single WebSocket connection (already partially implemented in `useExplorerWS`). The WebSocket should be the only real-time data source; REST queries should provide initial data only.

**No lazy loading for heavy pages**
`/explorer/map` (Leaflet) and `/governance` are heavy but not dynamically imported.
Fix:
```typescript
const Map = dynamic(() => import('@/components/NodeMap'), { ssr: false });
```

---

## 9. Security Observations

### 9.1 Credential Display
Proxy credentials (username, password) are displayed in plaintext after purchase. This is expected, but:
- No copy-to-clipboard with auto-clear after 30 seconds
- No warning that credentials should not be shared
- Credentials persist in component state until modal closes

### 9.2 Client-side Solana Operations
`lib/services/market.ts` calls `initializeEscrow` with raw lamport values computed client-side. A user could manipulate the amount before signing. The backend should be the authoritative source for escrow amounts (currently done via `initiateSmartContractPayment()` — this is correct, but verify the params are not overridable).

### 9.3 No CSRF Protection on Next.js API Routes
`/api/proxy/test` and `/api/sessions/stream` don't appear to validate `Origin` headers.

---

## 10. Bugs Confirmed

| # | Severity | File | Description |
|---|---|---|---|
| B1 | **Critical** | `marketplace/[id]/page.tsx:46` | Redirects to `/dashboard/proxies` (404) |
| B2 | **High** | `StreamingSessionCard.tsx:78` | `setInterval(100ms)` causes render flood |
| B3 | **High** | `dashboard/wallet/page.tsx` | `alert()` on wallet link/unlink error |
| B4 | **High** | `agents/page.tsx` | `alert()` on rent success and failure |
| B5 | **Medium** | `dashboard/analytics/page.tsx` | Hardcoded `₵` (Cedi) currency symbol |
| B6 | **Medium** | `dashboard/nodes/page.tsx` | Default trust score of 85 masks missing data |
| B7 | **Medium** | `dashboard/proxy/page.tsx` | Hardcoded proxy endpoint fallback |
| B8 | **Low** | Multiple | Magic numbers for intervals (10000, 30000) |
| B9 | **Low** | Multiple | `| string` in union types defeats TypeScript |
| B10 | **Low** | Multiple | `catch (err: any)` instead of `unknown` |

---

## 11. Pros & Cons Summary

### Pros ✅

1. **Ambitious, real feature set** — Solana escrow, L2 state channels, WebSocket feeds, smart matching, provider portal — not a typical CRUD app
2. **Correct React Query usage** in explorer — deduplication, caching, background refresh
3. **Consistent design language** — cyberpunk glassmorphism is visually distinctive and coherent
4. **Modular API layer** — 19 clean modules, clear separation of HTTP calls from UI
5. **Zustand for UI state** — correct tool for client-only state, no overuse
6. **Solana wallet integration** — message signing, escrow, wallet linking all correctly implemented
7. **TypeScript throughout** — all major types defined, optional chaining used
8. **Error boundaries** — `ErrorBoundary.tsx` exists at root level
9. **Loading states** — skeleton components + spinners present in most pages
10. **App Router adoption** — modern Next.js patterns used correctly

### Cons ❌

1. **`alert()` calls** — blocking browser-native dialogs in 4+ places; unacceptable for production
2. **Critical route bug** — purchase redirect sends users to 404
3. **Mixed data-fetching patterns** — `useEffect` + `useState` vs `useQuery` inconsistently
4. **No tests** — zero unit or integration tests; only Playwright config with no test files
5. **`| string` type erosion** — defeats the value of TypeScript union types
6. **No list virtualisation** — transaction and listing lists will degrade with real data volume
7. **100ms polling interval** — aggressive re-render cycle in session cards
8. **No optimistic UI** — all mutations block on server response
9. **Accessibility gaps** — icon buttons have no labels, no focus traps, no reduced-motion support
10. **Currency inconsistency** — Cedi symbol `₵` in analytics page vs SOL everywhere else
11. **Hardcoded proxy endpoint** — `proxy.proxyhub.io:3128` fallback in source code
12. **No error telemetry** — no Sentry or equivalent; errors are silently logged to console
13. **6 simultaneous REST polls** in Explorer — should be replaced by existing WebSocket

---

## 12. Improvement Roadmap

### Phase 0 — Critical Bugs (Fix before any launch)

| Task | File | Effort |
|---|---|---|
| Fix broken redirect | `marketplace/[id]/page.tsx` | 5 min |
| Replace all `alert()` with `toast()` | 4+ files | 2h |
| Fix `setInterval(100ms)` → `1000ms` | `StreamingSessionCard.tsx` | 30 min |
| Fix currency symbol | `dashboard/analytics/page.tsx` | 30 min |

### Phase 1 — Architecture Consistency (1–2 weeks)

- **Migrate all `useEffect` data fetching to `useQuery`** across dashboard pages
- **Create shared layout queries** for wallet balance, user profile, and node count — fetch once in root layout, share via context
- **Route groups** — create `(consumer)/` and `(provider)/` route groups with dedicated layouts
- **Centralised error handler** — `lib/utils/error.ts` with `getErrorMessage(err: unknown): string`
- **Global toast integration** — wire `Toast.tsx` to React Query's `onError` callbacks in `QueryProvider.tsx`

### Phase 2 — UX & Accessibility (1–2 weeks)

- **Add `aria-label`** to all icon-only buttons and navigation items
- **Focus trap in modals** — `BuyListingModal`, `WalletConnect`
- **Confirmation dialog** for session termination (destructive action)
- **`prefers-reduced-motion`** — wrap Framer Motion with `useReducedMotion()` guard
- **Optimistic UI** for session creation — add immediately, rollback on failure
- **Form validation** — Zod schemas on all forms, show inline errors

### Phase 3 — Performance (1 week)

- **Virtualise** transaction list, marketplace listing grid, node grid with `@tanstack/react-virtual`
- **Consolidate Explorer polling** — let `useExplorerWS` be the sole real-time source; REST queries provide initial data only
- **Dynamic import** Leaflet map, governance charts with `next/dynamic`
- **Memoise** stat card arrays, sidebar menu config with `useMemo`

### Phase 4 — Type Safety (ongoing)

- Remove all `| string` from discriminated unions
- Change all `catch (err: any)` to `catch (err: unknown)`
- Add `satisfies` on config objects and constant arrays
- Enable `strict` mode in `tsconfig.json` if not already

### Phase 5 — Testing (2–4 weeks)

- **Unit tests**: utility functions (`lib/utils/`), API response transforms
- **Integration tests**: React Testing Library for BuyListingModal, BuyFlow
- **E2E tests (Playwright)**: wallet link, create session, marketplace purchase, provider node registration

### Phase 6 — Observability (1 week)

- Integrate **Sentry** (or equivalent) for client-side error capture
- Add **Web Vitals** reporting to analytics backend
- Add **performance marks** around session creation and escrow flows

---

## 13. Recommended Structural Changes

### 13.1 Centralise Error Handling

```typescript
// lib/utils/error.ts (create this)
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'An unexpected error occurred';
}

// Usage in components
catch (err: unknown) {
  toast.error(getErrorMessage(err));
}
```

### 13.2 Shared Layout Data

```typescript
// app/dashboard/layout.tsx
export default function DashboardLayout({ children }) {
  const { data: wallet } = useQuery({ queryKey: ['wallet'], queryFn: getWallet });
  const { data: user } = useQuery({ queryKey: ['user'], queryFn: getCurrentUser });

  return (
    <DashboardContext.Provider value={{ wallet, user }}>
      <div className="flex">
        <Sidebar />
        <main>{children}</main>
      </div>
    </DashboardContext.Provider>
  );
}
```

### 13.3 Global Toast on Query Error

```typescript
// providers/QueryProvider.tsx
const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      onError: (err: unknown) => {
        toast.error(getErrorMessage(err));
      },
    },
  },
});
```

### 13.4 Replace 100ms Timer

```typescript
// StreamingSessionCard.tsx — replace setInterval(100ms) with:
useEffect(() => {
  let rafId: number;
  let lastTick = Date.now();

  const tick = () => {
    const now = Date.now();
    if (now - lastTick >= 1000) {  // Update once per second
      setCost(calculateCost());
      lastTick = now;
    }
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}, [session]);
```

### 13.5 Virtualised List

```typescript
// components/TransactionList.tsx
import { useVirtualizer } from '@tanstack/react-virtual';

const rowVirtualizer = useVirtualizer({
  count: transactions.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 56,
});
```

---

## 14. Technology Assessment

| Library | Version | Status | Action |
|---|---|---|---|
| Next.js | 16.1.1 | ✅ Current | Maintain |
| React | 19.2.3 | ✅ Current | Maintain |
| TailwindCSS | v4 | ✅ Current | Maintain |
| TanStack Query | v5.90 | ✅ Current | Adopt universally |
| Framer Motion | v12.27 | ✅ Current | Add `useReducedMotion` |
| Zustand | v5.0 | ✅ Current | Maintain |
| Solana Web3.js | v1.98 | ⚠️ Legacy | Evaluate Web3.js v2 |
| Recharts | v3.7 | ✅ Current | Maintain |
| `@supabase/supabase-js` | v2.90 | ✅ Current | Maintain |
| `react-window` | — | ❌ Missing | Add `@tanstack/react-virtual` |
| `zod` | — | ❌ Missing | Add for form validation |
| `sentry` | — | ❌ Missing | Add for error telemetry |

---

## 15. Files to Change (Priority Order)

```
CRITICAL (fix immediately):
  apps/web/src/app/marketplace/[id]/page.tsx     → Fix redirect path
  apps/web/src/app/agents/page.tsx               → Replace alert()
  apps/web/src/app/dashboard/wallet/page.tsx     → Replace alert()
  apps/web/src/components/StreamingSessionCard.tsx → Fix 100ms interval

HIGH (before public launch):
  apps/web/src/app/dashboard/analytics/page.tsx  → Fix ₵ currency
  apps/web/src/providers/QueryProvider.tsx        → Add global onError toast
  apps/web/src/lib/utils/ (new file)             → Add error.ts utility
  All dashboard pages                            → Migrate useEffect → useQuery

MEDIUM (next sprint):
  apps/web/src/components/Sidebar.tsx            → Add aria-labels
  apps/web/src/components/BuyListingModal.tsx    → Add focus trap, error detail
  apps/web/src/app/explorer/page.tsx             → Remove 4 polling queries
  apps/web/src/lib/api/*.ts                      → Remove | string type erosion

LOW (ongoing):
  All catch blocks                               → err: unknown, getErrorMessage()
  Large list pages                               → Add virtualisation
  All animated components                        → Add useReducedMotion()
```

---

## Appendix: Key Metrics

| Metric | Value |
|---|---|
| Total pages (routes) | ~40 |
| Components | 30+ |
| API modules | 19 |
| Service modules | 17 |
| Custom hooks | ~10 |
| `alert()` calls | 6+ |
| `| string` type violations | 12+ |
| `catch (err: any)` violations | 8+ |
| Test files | 0 |
| Magic number intervals | 6+ |
| Hardcoded constants | 4+ |
| Broken routes | 1 confirmed |
