# 13 — Security & Privacy Audit

Method: STRIDE/OWASP review across all planes + repo-wide secret scan (gitleaks config + manual). **No secret values are reproduced in this report — paths only.**

## 1. Secrets Hygiene

| Path | Type | Git-tracked? | Risk |
|------|------|--------------|------|
| `oracle-keypair.json` (root) | Solana keypair | No (ignored) | Empty placeholder (4B) |
| `treasury-keypair.json` | Solana keypair | No (ignored) | **Real 64-byte key on disk — Critical if funded** |
| `infra/oracle-keypair.json` | Solana keypair | No (ignored) | **Real key; mounted into compose containers** |
| `jwt.txt` | token material | No (ignored) | High if valid |
| `.tmp-buyer_dev_token`, `.e2e-*.json` | dev/e2e tokens | No | Medium |
| `certs/server.crt|key` | TLS | No | Medium (local) |
| `secrets/` | dir | No | empty |
| `.env`, `*/.env.local`, `config/docker/*.env` | env secrets | No (ignored) | High if mis-copied |
| `infra/k8s/pgbouncer.yaml:47-48` | **committed empty-password MD5 userlist** | **Yes** | **High (SEC-04)** |
| `infra/oracle-keypair.json.example` | example (zeros) | Yes | OK |

**Verdict:** git history is clean of real secrets (gitleaks CI + pre-commit gates exist). **Real key material lives on the workstation** — rotate if any of these keys ever controlled funded accounts; move to KMS/secret-manager (SEC-03).

## 2. STRIDE Summary

| Threat | Key findings | Status |
|--------|--------------|--------|
| Spoofing | Wallet-challenge auth strong; role-key mismatch (fixed BE-02); `X-Gateway-Auth` static secret; provider lease optional (PN-04) | Improved |
| Tampering | On-chain payout redirection (fixed BC-01/02, redeploy pending); usage-sig soft-accept (fixed BE-01); ledger mutable at DB (DB-03) | Improved |
| Repudiation | Ledger journal + audit logs exist; ledger not immutable at DB layer | Open |
| Info disclosure | NEXT_PUBLIC e2e wallet secret (fixed FE-03); hardcoded stats mislead trust; `ACAO:*` on Next API (FE-12); WS presence stub | Improved |
| DoS | WAF/DDoS, admission semaphore, rate limits; no per-session concurrency caps (GW-03); Redis SPOF (EV-05); no DLQ poison handling | Open |
| Elevation | Admin API env-gated + separate JWT; dispute admin on user-JWT group (BE-03); session-program admin holes (BC-03/04); pgbouncer/Redis weak creds (SEC-04/05) | Open |

## 3. OWASP Spot Checks

| Item | Result |
|------|--------|
| SQL injection | GORM parameterized throughout; no concatenated queries in prod paths |
| XSS | React-escaped; no `dangerouslySetInnerHTML` red flags found in audit scope |
| CSRF | Bearer-token primary (not cookie-only) → low risk; cookie flows same-site |
| CORS | whitelist + dev localhost-reflect; `StrictCORS` any-origin only in development |
| SSRF | gateway pre-DNS + provider post-DNS egress filtering (incl. 169.254.169.254) — solid, conditional on agent currency |
| File upload | not present |
| Rate-limit bypass | endpoint RL + WAF; bulk-key ZSET RL |
| Brute force / credential stuffing | wallet-auth (no passwords); admin login exists — confirm lockout policy (not evidenced) |
| Token leakage | access token memory-only frontend; logs redact? — not fully verified (recommend log-scrub audit) |
| Open relay | gateway 407s anonymous; misconfig risk documented (GW-10) |
| WebSocket hijacking | origin check `allowedWebSocketOrigin`; `/v1/ws` auth broken client-side |
| Dependency vulns | CI: govulncheck, gosec, npm audit, cargo-audit, Trivy (Trivy non-blocking `exit-code 0` — tighten) |

## 4. Fraud & Abuse Surface (marketplace-specific)

| Vector | Control | Gap |
|--------|---------|-----|
| Fake providers / self-dealing | provider application review, staking, proofs (observe/enforce) | no independent probing; reputation stub |
| Location spoofing | geo shard by node-reported geo | platform doesn't verify location (T4) |
| Usage inflation by provider | **gateway-measured bytes** (good) | WAL/nonce windows (GW-08) |
| Usage inflation by gateway | Ed25519 sigs (now fail-closed) | gateway is trusted party — add spot-audit reconciliation |
| Earnings manipulation | settlement worker + unique receipts | — |
| Buyer refund abuse | dispute + jury paths | no automatic failed-session credit (FIN-11) |
| Collusion (buyer=seller) | not detected | add graph analytics (Phase 5) |
| Withdrawal fraud | strong gate stack (10) | custodial hot wallet (BC-08) |

## 5. Privacy

- PII: email on profiles; message/forum content; GDPR delete endpoint exists (`/v1/gdpr/delete-account`).
- Traffic privacy: CONNECT preserves end-to-end TLS; gateway sees domains (SIT/CONNECT host) not content — logging of CONNECT targets should be minimized (verify log levels in `main.rs` before launch).
- Provider privacy: agent heartbeats expose provider IP/geo by design — disclose in provider terms.
- Data residency: not addressed in code/docs — decide before public launch.

## 6. Consolidated Security Findings

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| SEC-01 | Compose published Postgres/Redis on all interfaces | High | **Fixed** (loopback) |
| SEC-02 | Dev bypasses defaulted true | High | **Fixed** (default false) |
| SEC-03 | Real keypairs/JWT on workstation disk | High | Open (rotate/vault) |
| SEC-04 | pgbouncer empty-password MD5 committed | High | Open |
| SEC-05 | k8s Redis: protected-mode no, no auth | High | Open |
| SEC-06 | HAProxy `stats admin if TRUE` + exposed 8404 | Medium | Open |
| SEC-07 | NATS ports published, no auth | Medium | **Fixed** (loopback); auth still TODO |
| SEC-08 | Static `X-Gateway-Auth` shared secret | Medium | Open |
| SEC-09 | OTLP insecure gRPC | Low | Open |
| SEC-10 | Admin lockout policy unverified | Medium | Open |
| SEC-11 | CONNECT-target logging privacy unverified | Low | Open |
| FE-03 | NEXT_PUBLIC e2e wallet secret | Critical→ | **Fixed** |
| BE-06 | Dev HMAC fallback secret in bulk API | Medium | Open |
