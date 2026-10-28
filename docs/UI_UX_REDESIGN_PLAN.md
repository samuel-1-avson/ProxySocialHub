# ProxyHubb — UI/UX Redesign Plan

| Field | Value |
|---|---|
| Status | Draft for review — design only, no code in this phase |
| Date | 2026-10-28 |
| App | `apps/web` — Next.js 16 App Router, React 19, Tailwind v4, TanStack Query, Zustand |
| Decisions locked | ① Buyer-first, Provider as a workspace mode ② Explorer/Governance/DePIN/Treasury merge into one **Network** hub; Community demoted ③ This document first; old URLs get 301 redirects |
| Supersedes | Navigation/IA parts of the earlier "Quiet Infrastructure" reconstruction (tokens in `apps/web/src/app/globals.css` are kept and evolved, not replaced) |

---

## 0. One-sentence thesis

> ProxyHubb does **one job with two sides**: *get a working proxy* (buyer) and *earn from spare bandwidth* (provider). The new UI has **5 destinations** that map to that job — everything else is a tab, a sheet, a search result, or gone from the nav.

---

## 1. Diagnosis — what is wrong today

Evidence from the current tree (`apps/web/src/app`, `apps/web/src/lib/navigation/nav.ts`):

| # | Problem | Evidence |
|---|---|---|
| 1 | **100 pages for one marketplace** | 100 `page.tsx` files. A new user cannot hold the map in their head. |
| 2 | **8 sidebar sections, ~40 nav items** | `NAV_SECTIONS`: Use, Market, Sell, Advanced, Provider, Community, Explorer, Governance (+ bottom Wallet/Settings/Profile). Provider alone has 12 items. |
| 3 | **Same concept, 3–5 doors** | Orders: `/marketplace/orders` + `/dashboard/orders/[id]`. Messages: `/community/messages` + `/dashboard/messages`. Feed: `/community/feed` + `/dashboard/feed`. Map: `/marketplace/map` + `/explorer/map` + `/explorer/map/globe` + `/network`. Analytics: `/dashboard/analytics` + `/dashboard/usage` + `/dashboard/provider/analytics` + `/explorer/analytics`. Settings: `/settings/*` + `/dashboard/settings/*` + `/dashboard/security` + `/dashboard/profile` + `/profile/[username]`. Health: `/dashboard/provider/health` + `/dashboard/monitoring` + `/explorer/health`. Leaderboard: `/leaderboards` + `/explorer/leaderboard`. Earnings: `/dashboard/provider/earnings` + `/explorer/earnings`. Sessions: `/dashboard/sessions` + `/explorer/sessions`. |
| 4 | **Two apps interleaved** | Buyer, provider, explorer, governance, forum, and admin share one sidebar. Role filtering (`filter-nav.ts`) hides some items but the mental model stays "everything, everywhere". |
| 5 | **Nav is a sitemap, not a workflow** | Labels name *features* (Trustless, Agents, Circle pool, Relationships), not *user goals* (Connect, Buy, Get paid). Experimental surfaces (Agent console, Usage proofs) sit at the same level as Connect. |
| 6 | **Home doesn't answer "what now?"** | `/dashboard` is a stats grid (analytics, wallet, 7-day chart). The primary action — *connect to a proxy* — is a nav item, not the page itself. |
| 7 | **Visual debt under a good token base** | "Quiet Infrastructure" tokens are sound (flat surfaces, emerald signal, AA-tuned), but pages still mix legacy classes (`card-retro`, `glass-card`, `btn-retro`, `glow-emerald`), inline styles, and per-page layouts. Sidebar uses heavy black uppercase type, full-primary active pills, and a fake "OPERATOR / Authorized" identity block. |
| 8 | **Structure fights the architecture skill** | Code lives in `components/`, `features/` (only `wallet` uses it), `hooks/`, `lib/`, `stores/` mixed together. No `modules/{feature}/` boundaries, no barrels, styles not co-located per page. Any redesign that only re-skins files will re-clutter within months. |

**Design principles that follow from this:**

1. **One concept = one URL = one nav entry.** Duplicates merge; the loser 301s to the winner.
2. **Nav shows goals, pages show detail.** Max 5 primary destinations. Everything else is reached by tabs, search (⌘K), or contextual links.
3. **Mode, not menus, separates Buyer from Provider.** One workspace switcher changes the nav — instead of 12 provider items polluting the buyer nav.
4. **Public and app are one product.** Logged-out visitors see the same shell with public data; logging in fills in *your* data — it does not teleport you to a different app (`/dashboard/*` disappears as a prefix).
5. **Quiet by default.** Minimal theme (§6): one accent, flat surfaces, no gradients/glass/glow, generous whitespace, data in mono, motion only to explain state changes.

---

## 2. New information architecture

### 2.1 The 5 destinations

```
┌──────────────────────────────────────────────────────────────────┐
│  ProxyHubb    [ Use ▾ / Sell ]          ⌘K Search   ● Wallet  ◯  │  ← top bar (all viewports)
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1  Home        "Am I connected? What needs attention?"         │
│   2  Proxies     "Find, buy, and manage my proxies"  (Market)    │
│   3  Activity    "Sessions, orders, usage, money"                │
│   4  Network     "Is the network healthy? Explore it"  (public)  │
│   5  Settings    "Account, wallet, keys, security"               │
│                                                                  │
│   Provider mode swaps 2–3:  Nodes · Listings · Earnings          │
└──────────────────────────────────────────────────────────────────┘
```

| # | Destination | Route | Who | Answers |
|---|---|---|---|---|
| 1 | **Home** | `/` (logged-in) or `/home` | Everyone | Connection status, next action, 3 key numbers |
| 2 | **Proxies** | `/proxies` | Buyer (public browse) | Discover → compare → buy → connect |
| 3 | **Activity** | `/activity` | Buyer | Sessions, orders, usage & billing in one timeline |
| 4 | **Network** | `/network` | Public | Map, nodes, health, transactions, governance, treasury |
| 5 | **Settings** | `/settings` | Authenticated | Profile, wallet, API keys, security, notifications, devices |

Secondary (not in primary nav, reachable and indexed):

| Surface | Route | Entry points |
|---|---|---|
| Help & Forum | `/help`, `/help/forum/*` | Footer, `?` in top bar, empty-state links |
| Messages | `/messages` | Top-bar inbox icon with unread badge |
| Provider onboarding | `/sell` (landing) → `/sell/setup` | Top-bar mode switch, marketing CTA |
| Admin | `/admin` | Role-gated, never in nav for non-admins |
| Legal / docs | `/terms`, `/privacy`, `/whitepaper`, docs.proxyhubb.com | Footer only |

### 2.2 Navigation chrome

**Desktop — slim top bar + optional left rail, not an 8-section sidebar.**

Recommended layout: **top bar only** (Linear/Vercel/Stripe-Dashboard style), because 5 destinations fit horizontally and content (maps, tables) wants full width.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ◆ ProxyHubb   Home  Proxies  Activity  Network        ⌘K  ✉³  ◐  [avatar]│
│                                                  [ Use | Sell ] ← mode   │
├─────────────────────────────────────────────────────────────────────────┤
│  Page title          [ Primary action ]                                  │
│  Tabs:  Overview · Sessions · Orders · Usage        ← in-page, sticky    │
│  ─────────────────────────────────────────────────────────────────────  │
│  Content (max-w 1120px, maps/tables may go full-bleed)                   │
└─────────────────────────────────────────────────────────────────────────┘
```

Rules:

- **Mode switcher is the only role UI.** `Use | Sell` segmented control in the top bar (evolves today's `WorkspaceSwitcher`). Switching re-labels destinations 2–3 (see §3.2) and persists per user. Non-providers see `Sell` as "Start earning →" leading to `/sell`.
- **Tabs replace sub-menus.** Each destination owns ≤5 tabs rendered as a sticky underline tab bar under the page title. Tabs are real routes (`/activity/sessions`) for deep-linking, but visually one page.
- **⌘K command palette is the escape hatch.** Search listings, nodes, orders, transactions, pages, and actions ("Create listing", "Copy proxy credentials"). This is what lets the nav stay at 5 — power users jump, they don't browse menus. (Replaces `/explorer/search` as a page.)
- **Breadcrumbs only on detail pages** (`Proxies / Listing / #A3F2`). Top-level pages never show them. Removes today's always-on `Breadcrumbs` in `AppShell`.
- **Mobile: bottom tab bar with the same 5** (Home, Proxies, Activity, Network, More→Settings/Messages/Help). Mode switch moves into the avatar sheet. No hamburger sitemap (today's `MOBILE_MORE_SECTIONS` re-lists all 8 sections — deleted).
- **Wallet status is a pill, not a page-first concept:** `● 12.4 SOL` in the top bar; click → wallet sheet (balance, escrows, send/receive); "View wallet" → `/settings/wallet`.
- **One shell for public + app.** `MarketingHeader`, `Navbar`, and `Sidebar` collapse into a single `AppShell` header. Logged-out: destinations show public data with "Sign in" CTA. No separate marketing chrome.

### 2.3 What disappears from navigation (features survive elsewhere — see §4)

Dashboard, Connect-as-page, Usage & billing, Access Passes, Supply map, Usage proofs, Agent console, My analytics, Operations, 12× Provider items, Forum, Activity feed, Invite, 10× Explorer items, Proposals, Create proposal, Treasury — **~35 nav entries → 5 + tabs.**

---

## 3. Destination-by-destination design

Page anatomy is identical everywhere (this repetition *is* the minimal feel):

```
Page title (20px, semibold)            [Secondary] [Primary]
One-line description in muted text (optional, max 1 line)
Tabs ─────────────────────────────────────────────────────
[ Status strip / filter bar — only if the page needs one ]
Content: one primary surface (table | map+list | card grid ≤3 cols)
Empty state: one sentence + one button. Never an illustration wall.
```

### 3.1 Home `/`

The only "dashboard". Answers in 3 seconds: *Am I connected? Is anything wrong? What's my next step?*

```
┌──────────────────────────────────────────────────────────────┐
│  ● Connected — Frankfurt, DE · SOCKS5 · 42ms      [Disconnect]│  ← status hero; if offline:
│     Session ends in 3h 12m · 1.2 GB used                      │    "Not connected" + [Connect]
├──────────────────────────────────────────────────────────────┤
│  Balance 12.4 SOL │ Active proxies 2 │ Used this month 8.1GB │  ← 3 numbers, mono, no charts
├──────────────────────────────┬───────────────────────────────┤
│  Your proxies (2)            │  Needs attention              │
│  • DE residential  [Connect] │  • Order #881 escrow expiring │
│  • US datacenter   [Connect] │  • Node fra-1 offline (Sell)  │
│        [Browse proxies →]    │        (empty = "All clear")  │
├──────────────────────────────┴───────────────────────────────┤
│  Recent activity — last 5 events, one line each  [View all →] │
└──────────────────────────────────────────────────────────────┘
```

- New users see a **3-step checklist instead** (Connect wallet → Pick a proxy → Connect), replacing `NewUserDashboard` + `/onboarding` as separate surfaces. Checklist lives on Home until complete, then collapses forever.
- No 7-day area chart on Home (moves to Activity › Usage). Home is status + actions, not analytics.
- Provider mode Home swaps the hero: *Nodes online 2/3 · Earned this month 4.2 SOL · [Node fra-2 needs attention]*.

### 3.2 Proxies `/proxies` (was: Marketplace + Discover + Map + Saved + Connect)

One page, two views. This is the product's core loop and gets the most design care.

| Tab | Route | Content |
|---|---|---|
| **Browse** (default) | `/proxies` | Split view: list left (filters on top), map right. Toggle `List | Map` on mobile. Filters: country, type, protocol, price, speed — as a single filter bar + "More filters" sheet. Sort: Recommended / Price / Speed. |
| **Mine** | `/proxies/mine` | Purchased/active proxies with credentials, expiry, per-proxy Connect button, extension pairing QR. (Absorbs `/dashboard/proxy` "Connect" and order-credentials views.) |
| **Saved** | `/proxies/saved` | Bookmarked listings (was `/marketplace/saved`). |

Detail: `/proxies/[id]` — one column: price & buy box sticky right on desktop; health metrics labeled with provenance (keep the "metric honesty" labels — measured vs unmeasured — it's a trust feature); reviews below; seller card links to public profile.

Buy flow is a **sheet, not pages**: Buy → amount/duration → wallet sign (escrow) → credentials revealed → "Connect now" (deep-links extension/SDK snippet with copy buttons). 4 steps in one overlay, progress as `1—2—3—4`.

Provider mode, this destination becomes **Listings** (`/sell/listings`): table of my listings/products, `[+ New listing]` opens the create form as a full-page step flow (`/sell/listings/new`); catalog/products become a tab, not a separate section.

### 3.3 Activity `/activity` (was: Sessions + Orders + Usage + Analytics + Trustless)

One chronological home for "what happened and what did it cost".

| Tab | Route | Content |
|---|---|---|
| **Overview** | `/activity` | Unified timeline (session started, order settled, payout sent…) + usage chart (7/30/90d) + spend summary. |
| **Sessions** | `/activity/sessions` | Live sessions pinned on top with Disconnect; history table below. Session detail opens as a side sheet (bandwidth graph, endpoints, settlement, usage proof link). |
| **Orders** | `/activity/orders` | Orders with escrow state machine visualized as `Funded → Active → Settled → Closed`. Detail `/activity/orders/[id]`. |
| **Billing** | `/activity/billing` | Access Passes/subscriptions, invoices, per-proxy spend. (Absorbs `/dashboard/subscriptions`, `/dashboard/usage`.) |

Usage proofs (was `/dashboard/trustless`) become a **"Verify" action on a session/order** — a sheet showing the Merkle anchor — not a nav destination. Honest label kept: "Oracle-attested · not ZK yet".

Provider mode: Activity → **Earnings** (`/sell/earnings`): balance, payout history, per-node revenue tab, customers tab (absorbs Relationships).

### 3.4 Sell mode (was: 12 Provider pages + 3 Sell pages → 3 tabs)

Switching to Sell replaces destinations 2–3:

| Destination | Route | Tabs |
|---|---|---|
| **Nodes** | `/sell/nodes` | Nodes (status table, health inline — absorbs Diagnostics) · Setup (absorbs Setup + CLI & download + API tokens: one guided page: ① install command ② token ③ verify heartbeat) · Services (advanced, collapsed by default) |
| **Listings** | `/sell/listings` | Listings · Products (catalog) · Supply map is deleted as a page — listings show "visible in: Frankfurt" text; the public map is in Proxies/Network |
| **Earnings** | `/sell/earnings` | Overview · Payouts · Customers · Circle pool (shown only if enrolled — feature-flagged tab) |

`/sell` logged-out/non-provider = landing ("Earn from spare bandwidth", earnings calculator, one CTA) → `/sell/setup` wizard. "Become a provider" and "Provider hub" pages are deleted; the hub *is* Sell-mode Home.

Agent console → moves to `/settings/developer` as an **Experimental** card, clearly badged "Preview — no payments yet". Operations/Monitoring → `/admin` only (it was never a user feature).

### 3.5 Network `/network` (was: Network + Explorer×15 + Governance + Treasury + DePIN + Leaderboards)

Public, read-only, one hub with tabs. Kills the separate `explorer/layout.tsx` chrome and `explorer-nav.ts`.

| Tab | Route | Absorbs |
|---|---|---|
| **Overview** | `/network` | Live stat strip (nodes online, sessions, volume), mini-map, recent transactions. (Current `/network` + `/explorer` home.) |
| **Map** | `/network/map` | Full map + globe toggle (`2D | Globe` segmented control — merges `/explorer/map`, `/explorer/map/globe`, `/marketplace/map` public view). |
| **Nodes** | `/network/nodes`, `/network/nodes/[id]` | Node table + detail; **Compare** becomes checkbox-select 2 nodes → compare bar (was its own page). |
| **Transactions** | `/network/transactions`, `/network/transactions/[hash]` | Transactions + Blocks merged into one table with a `Type` filter (blocks are a filter value, not a page). Contracts & Wallets: no browse pages — reachable via ⌘K/address search → detail pages `/network/address/[address]` (one template for wallet/contract). |
| **Health** | `/network/health` | `/explorer/health` + network analytics charts. |
| **Governance** | `/network/governance`, `/network/governance/[id]`, `/network/governance/new` | Proposals + create. Treasury = a card + tab section inside Governance (`/network/governance/treasury`), not a top-level site. |
| **Leaderboard** | `/network/leaderboard` | Merges `/leaderboards` + `/explorer/leaderboard` + `/explorer/earnings` (earnings = a sort column). |

Deleted as pages (data folds into tabs above): `/explorer/search` (→ ⌘K), `/explorer/sessions` (→ Overview recent + node detail), `/explorer/analytics` (→ Health), `/depin` (→ marketing section on public Home / `/sell` story), `/treasury` standalone.

### 3.6 Settings `/settings` (was: Settings×6 + Security + Profile + Wallet pages)

Left sub-nav *inside* Settings only (the one place a secondary rail is allowed):

```
Profile · Wallet · Access Passes · API keys · Developer · Security · Notifications · Devices
```

- `/settings/profile` — account + identity merged (was Account + Identity + `/dashboard/profile`). Public profile stays at `/profile/[username]` (view-only, linked as "View public profile").
- `/settings/wallet` — full wallet (balances, escrows, history, MoonPay on-ramp). Absorbs `/dashboard/wallet` incl. callback route.
- `/settings/developer` — API keys, provider tokens shortcut, SDK snippets, Agent console (Preview), webhooks if any.
- One `/settings/security` (merges `/dashboard/security` + `/dashboard/settings/security`).

### 3.7 Community → demoted, not deleted

| Today | Tomorrow |
|---|---|
| Forum (8 routes) | `/help/forum/*` under Help. Recent/Popular/Unanswered/My-posts become **filter tabs** on one list page, not 4 routes. |
| Feed / Friends / Beta | **Removed from product** (routes 301 → `/help/forum`). Social graph is not the marketplace's job; revisit only with usage data. Flagged as the one true feature cut — needs your sign-off (§9). |
| Messages | `/messages` — top-bar inbox icon; conversation view single page. Merges the `/dashboard/messages` duplicate. |
| Referrals | `/settings/referrals` — "Invite & earn" is account settings, not community. |
| Help / Guidelines / Contact | `/help` hub: FAQ + Forum + Contact + Guidelines as sections. |

### 3.8 Marketing / logged-out

`/` logged-out keeps today's hero direction (network pulse visual) but is restructured: Hero (one headline, two CTAs: *Browse proxies* / *Start earning*) → live network strip (real numbers, links to `/network`) → How it works (Discover → Escrow → Connect → Settle, 4 steps) → Pricing/Access Passes → DePIN story (absorbs `/depin`) → Footer. Same header as the app; signing in morphs `/` into Home (§3.1) at the same URL.

Auth: `/login` + `/register` merge into one `/auth` page (wallet-first: "Continue with wallet", email as secondary). `/onboarding` deleted (Home checklist, §3.1).

---

## 4. Merge map — every current route accounted for

100 pages → **~35 routes**. `301` = redirect in `next.config.ts`; `merge` = content folds into target; `cut` = removed (needs sign-off, §9).

| Current | → New | Action |
|---|---|---|
| `/` (marketing) | `/` (marketing ↔ Home) | merge |
| `/dashboard` | `/` Home | 301 |
| `/dashboard/proxy` (Connect) | `/proxies/mine` + Home hero | 301 |
| `/dashboard/sessions` | `/activity/sessions` | 301 |
| `/dashboard/orders/[id]` | `/activity/orders/[id]` | 301 |
| `/dashboard/usage` | `/activity/billing` | 301 |
| `/dashboard/analytics` | `/activity` overview | 301 |
| `/dashboard/subscriptions` | `/settings/passes` + `/activity/billing` | 301 |
| `/dashboard/trustless` | session/order "Verify" sheet | 301 → `/activity/sessions` |
| `/dashboard/agents` | `/settings/developer` (Preview card) | 301 |
| `/dashboard/monitoring` | `/admin` | 301 |
| `/dashboard/admin` | `/admin` | 301 |
| `/dashboard/wallet`, `/dashboard/wallet/callback` | `/settings/wallet` (+ callback preserved) | 301 |
| `/dashboard/security` + `/dashboard/settings/security` | `/settings/security` | merge + 301 |
| `/dashboard/profile` + `/dashboard/settings/account` + `/dashboard/settings/identity` | `/settings/profile` | merge + 301 |
| `/dashboard/settings/api-keys` | `/settings/developer` | 301 |
| `/dashboard/settings/devices` | `/settings/devices` | 301 |
| `/dashboard/settings/notifications` + `/settings/notifications` + `/settings` | `/settings/notifications` / `/settings` | merge + 301 |
| `/dashboard/feed` + `/community/feed` + `/community/friends` + `/community/beta` | — | **cut** (301 → `/help/forum`) |
| `/dashboard/messages` + `/community/messages` | `/messages` | merge + 301 |
| `/dashboard/become-provider` | `/sell` | 301 |
| `/dashboard/provider` (hub) | `/sell` (Sell Home) | 301 |
| `/dashboard/provider/setup` + `/cli` + `/tokens` | `/sell/nodes/setup` (one guided page) | merge + 301 |
| `/dashboard/provider/nodes` | `/sell/nodes` | 301 |
| `/dashboard/provider/health` | `/sell/nodes` (health inline) | 301 |
| `/dashboard/provider/services` | `/sell/nodes/services` tab | 301 |
| `/dashboard/provider/analytics` | `/sell/earnings` overview | 301 |
| `/dashboard/provider/earnings` | `/sell/earnings` | 301 |
| `/dashboard/provider/relationships` | `/sell/earnings/customers` tab | 301 |
| `/dashboard/provider/circle` | `/sell/earnings/circle` tab (flagged) | 301 |
| `/marketplace` | `/proxies` | 301 |
| `/marketplace/[id]` | `/proxies/[id]` | 301 |
| `/marketplace/map` | `/proxies` (map view) / `/network/map` | 301 → `/proxies?view=map` |
| `/marketplace/saved` | `/proxies/saved` | 301 |
| `/marketplace/orders`, `/marketplace/orders/[id]` | `/activity/orders`, `/activity/orders/[id]` | 301 |
| `/marketplace/create` | `/sell/listings/new` | 301 |
| `/marketplace/manage`, `/marketplace/manage/products` | `/sell/listings` (+ Products tab) | 301 |
| `/providers/[id]` | `/profile/[username]` seller view (or `/network/nodes` owner card) | merge + 301 |
| `/network` | `/network` overview | keep |
| `/explorer` + 14 subroutes | `/network/*` per §3.5 | merge + 301 |
| `/explorer/search` | ⌘K palette; `/network/address/[address]` for direct hits | 301 → `/network` |
| `/governance`, `/governance/[id]`, `/governance/create` | `/network/governance/*` | 301 |
| `/treasury` | `/network/governance/treasury` | 301 |
| `/leaderboards` + `/explorer/leaderboard` + `/explorer/earnings` | `/network/leaderboard` | merge + 301 |
| `/depin` | section on `/` + `/sell` | 301 → `/sell` |
| `/community/forum/*` (8) | `/help/forum/*` (list+filters, thread, category, new) | merge + 301 |
| `/community/referrals` | `/settings/referrals` | 301 |
| `/help`, `/guidelines`, `/contact` | `/help` hub sections | merge + 301 |
| `/login`, `/register` | `/auth` | merge + 301 |
| `/onboarding` | Home checklist | 301 → `/` |
| `/profile`, `/profile/[username]` | keep (public view); edit → `/settings/profile` | keep |
| `/403`, `/terms`, `/privacy`, `/privacy/extension`, `/whitepaper` | keep | keep |

Resulting route count: Home 1 · Proxies 4 · Activity 5 · Sell 8 · Network 9 · Settings 8 · Messages/Help/Auth/Admin/legal ~8 → **≈43 file routes incl. details, 5 nav destinations.**

---

## 5. Key user flows (target click counts)

| Flow | Today (approx.) | New |
|---|---|---|
| First proxy connection (new user) | Landing → Register → Onboarding → Dashboard → Marketplace → Listing → Order → Dashboard/Proxy → credentials ≈ 8 pages | `/` checklist → Browse → Buy sheet → **Connect** = 3 surfaces |
| Reconnect (returning buyer) | Login → Dashboard → Connect/Sessions ≈ 3 pages | Home hero **[Connect]** = 1 click |
| Check what a session cost | Dashboard → Usage *or* Sessions *or* Orders (guess) | Activity › Sessions → sheet shows cost + settlement |
| Provider: add a node | Become provider → Hub → Setup → Tokens → CLI → Nodes ≈ 5 pages | Sell › Nodes › Setup: ① install ② token ③ verify — 1 page |
| Provider: am I earning? | Provider hub → Earnings *or* Analytics | Sell Home hero + Earnings tab |
| Look up a transaction | Explorer → Search *or* Transactions → detail | ⌘K paste hash → detail |
| Find anything | Browse 8 sidebar sections | ⌘K |

Flow rules:
- **Buy, Connect, Disconnect, Verify, Copy credentials** are actions (buttons/sheets), never pages.
- Every destructive/money action states amount + wallet signature consequence in the sheet before signing. Escrow state is always shown as the 4-step stepper, same component everywhere.
- Empty states teach the next step with exactly one button.
- Errors are inline at the field/action; toasts only confirm completed async work. No `AlertCenter` global stack competing with the wallet pill — notifications live behind one bell with a list, items deep-link to the relevant tab.

---

## 6. Visual theme — "Quiet Infrastructure, finished"

Keep the existing token foundation in `apps/web/src/app/globals.css` (it is already minimal and AA-tuned) and **finish the migration** instead of inventing a new palette. The redesign's visual work is mostly *subtraction*.

### 6.1 Tokens (evolve, don't replace)

| Token | Light | Dark | Rule |
|---|---|---|---|
| Background | `#f7f8fa` | `#0a0c10` | Flat. No gradients anywhere except the marketing hero mesh (data visual, not decoration). |
| Card/surface | `#ffffff` | `#10141c` | 1px border `#d8dde4` / `#232a36`, radius **10px max**, shadow only for popovers/sheets (`--shadow-pop`). |
| Primary (signal emerald) | `#0a6e4e` | `#34d399` | **The only accent.** Reserved for: primary button, active tab underline, links, live/connected dot. Never for large fills, icons-by-default, or chart rainbow. |
| Text | `#0a0e14` / muted `#2f3744` | `#eef1f6` / `#9aa3b2` | Two text levels only (+ destructive). No colored text for decoration. |
| Status | success=primary · warning `#a16207` · error `#b42318` · info `#1d4ed8` | tuned equivalents | Status = dot + label, not filled pill backgrounds (pills only for escrow steps). |
| Type | Geist Sans (UI) · Geist Mono (numbers, hashes, credentials — `.font-data`) | — | Scale: 12/14/16/20/28 only. Page title 20 semibold; hero (marketing only) 56–72. **Delete** `font-black uppercase tracking-tighter` sidebar style and all-caps micro-labels except tab/section eyebrows at 11px. |
| Spacing | 4px base; page padding 24 (mobile 16); card padding 16/20; section gap 24 | — | Whitespace separates; borders rarely do. Max content width 1120px (maps/tables full-bleed inside their tab). |
| Motion | `--dur-fast 120ms` / `--dur-med 200ms`, ease-out | — | Animate only: sheet/palette entry, tab underline, connection state change. Remove `animate-float`, hover rotate/scale on logo, blinking cursor. `prefers-reduced-motion` already handled — keep. |
| Icons | Lucide, 16–18px, stroke 1.5, muted until active | — | No emoji in UI. One icon per nav/tab item max; tables prefer text. |

### 6.2 Deletions (legacy visual debt)

`card-retro`, `glass-card`, `glass-industrial`, `btn-retro*`, `glow-emerald`, `scanline-effect`, `blinking-cursor`, glass aliases — removed once pages migrate to `ui/` primitives. Active nav = **text foreground + 2px emerald underline** (tabs) / subtle `surface-hover` fill (rail items), never a solid primary pill.

### 6.3 Component inventory (the whole kit — if it's not here, it doesn't ship)

Primitives (`shared/components/ui`): Button (primary/secondary/ghost/destructive × sm/md), Input, Select, Switch, Tabs, Table, Sheet, Dialog, Popover, CommandPalette (⌘K), Toast, Skeleton, EmptyState, StatNumber, StatusDot.

Patterns (`shared/components/patterns`): PageHeader (title+actions+tabs), FilterBar, EscrowStepper, CredentialCard (copyable, mono, masked until reveal), WalletPill + WalletSheet, ConnectionHero, DataProvenanceLabel (measured/unmeasured), TimelineRow.

Rule: **no inline `style={{}}`**; styling lives in co-located `{name}.styles.ts` Tailwind class maps via `cn()` (per frontend-architecture §5) or the primitive's variants (`cva`). Charts: single-hue (emerald area at 12% fill, grey grid), no multi-color series unless comparing nodes (max 3 hues, documented).

### 6.4 Accessibility & quality bars

WCAG AA contrast (already token-tuned — re-verify per page), visible focus ring (exists), full keyboard path incl. ⌘K and sheet focus-trap, touch targets ≥40px, tables usable at 360px (card-collapse), `prefers-reduced-motion` respected, Lighthouse a11y ≥95 on the 5 destinations.

---

## 7. Code architecture for the rebuild (frontend-architecture skill)

The redesign lands on the module structure from the `frontend-architecture` skill so it stays clean. Next.js App Router stays; `app/` becomes thin route files mounting module pages.

```
apps/web/src/
├── app/                      ← thin routes only: (public)/(app) groups, layout = AppShell
│   ├── (app)/proxies/page.tsx      → import { ProxyBrowsePage } from "@/modules/proxies"
│   └── ...
├── modules/
│   ├── home/        index.ts · pages/home/ · hooks/ · stores/ · types/ · README.md
│   ├── proxies/     browse, mine, saved, listing-detail, buy-sheet; services/ listings API
│   ├── activity/    overview, sessions, orders, billing
│   ├── sell/        nodes, listings, earnings, setup
│   ├── network/     overview, map, nodes, transactions, health, governance, leaderboard
│   ├── settings/    profile, wallet, developer, security, …
│   ├── messages/ · help/ (forum) · auth/ · admin/
├── shared/
│   ├── components/ui + patterns/    (§6.3 inventory only)
│   ├── api-client/                  one typed client (today's lib/api, consolidated)
│   ├── navigation/                  routes.ts (new map + redirects), nav.ts (5 destinations)
│   ├── store/                       root wiring; per-module Zustand UI stores in modules/*/stores
│   └── utils/ types/ constants/
```

Non-negotiables from the skill:
- **Barrel-only cross-module imports** (`@/modules/proxies`, never deep paths). ESLint `no-restricted-imports` enforces it.
- **Server state = TanStack Query only** (per-module key factories, e.g. `proxyKeys`, `orderKeys`); **UI state = per-module Zustand store** (`I`-prefixed interfaces, selectors, `reset`). Nothing fetched is mirrored into Zustand — audit today's stores during migration.
- **Pages are directories**: `pages/{page}/{page}.tsx` + `{page}.styles.ts` + `index.ts` + `README.md` (route, params, permissions, data deps).
- **Promotion ladder**: page-local → module `components/` → `shared/` only on second consumer.
- Today's `features/wallet` folds into `modules/settings` (wallet page) + `shared` (WalletPill); `components/*` is triaged into modules/shared or deleted — no dumping ground survives.

---

## 8. Phased implementation plan (after this doc is approved)

Each phase is independently shippable; old and new can coexist behind redirects.

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Foundations** (no visible change) | `modules/` + `shared/` skeleton, ESLint barrel rule, new `routes.ts` + redirect table stub, ⌘K palette, new `AppShell` header behind a flag | Typecheck + lint green; flag off = today's UI |
| **1. Shell + Home** | Top-bar nav (5 destinations, mode switch, wallet pill), mobile tab bar, new Home (connection hero + checklist) | Returning buyer reconnects in 1 click; sidebar deleted |
| **2. Proxies** | Browse (list+map), Mine, Saved, detail, buy sheet | Full buy→connect E2E (existing `test:e2e:marketplace` suite re-pointed) green |
| **3. Activity** | Overview timeline, Sessions (+Verify sheet), Orders (+stepper), Billing | Old dashboard/order/session URLs 301; suites green |
| **4. Sell mode** | Nodes (+setup wizard), Listings, Earnings | Provider E2E (setup→node online→listing live) green |
| **5. Network hub** | 7 tabs absorbing Explorer/Governance/Treasury/Leaderboards | All `/explorer/*` 301; public pages SSR/SEO checked |
| **6. Settings + Help + Auth** | Settings rail, `/messages`, `/help/forum`, `/auth`; cut feed/friends/beta | Merge map (§4) fully checked off; `validate:routes` updated |
| **7. Cleanup** | Delete legacy CSS classes, `filter-nav`, old shells (`Sidebar`, `Navbar`, `MarketingHeader`), dead components | Zero `card-retro/glass/btn-retro` references; bundle size ≤ before |

Verification per phase: `npm run typecheck`, `npm run lint`, relevant Playwright suites, plus a manual click-count check against §5. Routes validator (`scripts/validate-routes.mjs`) is updated in the same PR as any route change.

---

## 9. Decisions still needed from you

1. **Feature cut sign-off**: Feed, Friends, Beta removed (§3.7). Everything else is merged, not cut — these three are the exception.
2. **Circle pool & Agent console**: kept as flagged tab / Preview card per this plan. Confirm they're still on the roadmap, else cut now while it's cheap.
3. **Globe view**: kept as a Map toggle (Three.js cost stays). Confirm it's a keeper vs. 2D-only.
4. **Home URL**: plan puts logged-in Home at `/` (same URL as marketing). Alternative is `/home` with `/` always marketing. Recommend `/` — confirm.
5. **Name check**: destinations are *Home · Proxies · Activity · Network · Settings* (Sell mode: *Nodes · Listings · Earnings*). Confirm vocabulary before Phase 1 hard-codes it.

---

## 10. Success metrics

| Metric | Today | Target |
|---|---|---|
| Primary nav items | ~40 | 5 (+ tabs) |
| Routes | 100 | ≈43 |
| Clicks: returning buyer → connected | ~3 pages | 1 |
| Clicks: new user → first connection | ~8 pages | 3 surfaces |
| Duplicate concepts (orders/messages/maps/settings…) | ≥8 duplicated | 0 |
| Time-to-understand (5-sec test on Home) | stats grid | "Connected / not + next action" |

*End of plan. Next step on approval: Phase 0 scaffolding per §7–§8, or Figma/wireframes of Home + Proxies first if you want visuals before code.*

