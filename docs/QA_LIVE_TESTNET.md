# Live testnet QA smoke

Blackbox QA against the public testnet hosts. Does **not** use local Docker and does **not** mutate account state.

| Host | Role |
|------|------|
| `https://proxyhubb.com` | Web |
| `https://api.proxyhubb.com` | Control API |
| `https://proxy.proxyhubb.com` | Edge TLS reachability (optional until DNS exists) |

## Quick start

```bash
node scripts/qa-live-testnet.mjs
```

With auth-gated checks (read-only):

```bash
QA_LIVE_JWT='<access_token>' node scripts/qa-live-testnet.mjs
```

Write a JSON summary:

```bash
QA_LIVE_JSON=1 node scripts/qa-live-testnet.mjs
# → qa-live-results.json
```

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `WEB_BASE` | `https://proxyhubb.com` | Web origin |
| `API_BASE` | `https://api.proxyhubb.com` | API origin |
| `PROXY_BASE` | `https://proxy.proxyhubb.com` | Edge / proxy origin |
| `QA_LIVE_JWT` | _(empty)_ | Bearer token for auth probes; omit to skip |
| `QA_LIVE_JSON` | `0` | Set `1` to write `qa-live-results.json` |
| `QA_LIVE_REQUIRE_PROXY` | `0` | Set `1` to fail when proxy TLS/DNS is down |
| `QA_LIVE_TIMEOUT_MS` | `20000` | Per-request timeout |

## What it checks

### Public (always required)

- `GET /health`, `GET /ready` (readiness checks DB+Redis; smoke falls back to `/health` if `/ready` is undeployed)
- `GET /v1/system/config/public` — `treasury_configured === true` and non-empty `treasury_solana`
- `GET /v1/solana/health` — reachable; **fails** if network is mainnet / mainnet-beta
- `GET /v1/system/map/health`, `/v1/marketplace/map`, `/v1/listings?limit=2`
- `GET /api/health` on web
- HTML smoke: `/`, `/login`, `/onboarding`, `/marketplace`, `/explorer`, `/dashboard/wallet`
- `proxy.tls` — warn-only until `QA_LIVE_REQUIRE_PROXY=1` (DNS for `proxy.proxyhubb.com` may be unpublished)

### Auth (when `QA_LIVE_JWT` is set)

Read-only only — no `POST /v1/kyc/start`, deposits, or provider apply:

- `GET /v1/auth/me`
- `GET /v1/onboarding` (expects `kyc_status`; falls back to `/v1/auth/me` if undeployed)
- `GET /v1/wallet`
- `GET /v1/kyc/status/{user_id}`
- `GET /v1/security/mfa/status`

## CI

Workflow: [`.github/workflows/qa-live-testnet.yml`](../.github/workflows/qa-live-testnet.yml)

- Runs every 30 minutes and on `workflow_dispatch`
- Uploads `qa-live-results.json` as an artifact when present
- Repo secret `QA_LIVE_JWT` enables auth probes (`/me`, onboarding, wallet, KYC status, MFA)
- `proxy.proxyhubb.com` DNS is not published yet (Cloudflare); keep `QA_LIVE_REQUIRE_PROXY` unset until an A/CNAME exists. Then set workflow env `QA_LIVE_REQUIRE_PROXY: '1'`.

### Rotating `QA_LIVE_JWT`

The stored token is a long-lived HS256 access JWT (issued for ~180 days) for a live testnet profile. Rotate before expiry:

1. Mint a new access token signed with the live `JWT_SECRET` (same claims shape as control-api: `sub`, `role`, `email`, `wallet`, `iss=proxyhubb-control-api`).
2. Verify read-only: `QA_LIVE_JWT=… node scripts/qa-live-testnet.mjs`
3. Update: `gh secret set QA_LIVE_JWT --repo <owner/repo>`

Thin liveness remains in [`.github/workflows/uptime-probe.yml`](../.github/workflows/uptime-probe.yml) (`/health` only).

## Post-deploy checklist (manual)

Use after rolling `control-api` / `web` on the GCE VM. Automated smoke covers most of this; walk the UI for the rest.

1. **Treasury** — Wallet deposit UI shows a treasury address (not “not configured”). Smoke asserts `treasury_configured`.
2. **KYC / onboarding** — Provider path shows **Start verification** for `none` / `not_started`. Balance ≥ 0.05 SOL on linked wallet should approve on testnet (do this once manually; smoke does not call start).
3. **Wallet mismatch** — Connecting a Phantom account that is not the linked wallet shows a clear mismatch banner.
4. **Profile save** — Settings → Identity: edit display name / username and save without silent failure.
5. **2FA** — Settings → Security: MFA status loads; setup QR renders (otpauth), not a dead charts URL.
6. **Public surfaces** — Marketplace, explorer, login load without 5xx.

## Non-goals

- Wallet signing / Phantom automation
- Live deposits or withdrawals
- Mutating KYC or provider applications from CI
- Local Playwright marketplace E2E (see `apps/web` `npm run test:e2e:*`)
