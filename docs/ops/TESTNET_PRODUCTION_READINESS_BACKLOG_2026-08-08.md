# Testnet production-readiness backlog (2026-08-08)

**Target:** Make `proxyhubb-testnet` (Solana **devnet**) credible for wider invites — not mainnet.  
**Current score:** ~**8.0/10** controlled Testnet. Decentralization ~**2.7/5** hybrid.

**Verdict:** Limited-cohort **invite-ready** on Solana **devnet** (banner + API load floor + CONNECT soak + money path). Single-VM SPOF **formally accepted** for Phase A (`PHASE_A_SPOF_ACCEPTANCE_20260809T140300Z.md`); always-on / large public still needs Phase B HA exit; historical journal dual-write drift **cleared** (`DB01_dual_write_harden_20260809T141313Z.md`); M4 journal-as-SoT still open; not mainnet.

### Wave 1 progress (2026-08-08 evening)
| Item | Status |
|------|--------|
| S3 operator visibility | **PASS** — Slack/PD removed; `ops_alerts` + NATS + Grafana webhook live (`S3_observability_20260808T183519Z.md`) |
| TRIAGE-01 | **Mostly cleared** — vault surplus; journal dual-write gap on `fe793802` (~**7.6 SOL**) later **cleared** by DB-01 backfill (`DB01_dual_write_harden_20260809T141313Z.md`); interim soft-pedal was `INVITE_PACKAGING_20260808T224200Z.md` |
| E2E pack | **PASS** (CONNECT proven) — buy→creds→**CONNECT_OK**→release-queued; evidence `E2E_connect_pack_20260808T203627Z.md`. Root fix: Redis session keys were `session:ENC:…` (GORM BeforeSave); control-api rebuilt on VM. Withdraw still soft-fail (503 hot-balance / RPC), not freeze |
| S8 DR | **PASS** restore drill — `S8_dr_20260808T175337Z.md` |

**Wave 1 core closed** on CONNECT. Soft money-exit (2026-08-08 late → night):
- **Withdraw hardened/proven** — HTTP 200 for 0.01 SOL after RPC failover (`SETTLE_WITHDRAW_20260808T212340Z.md`).
- **Settle hard-pass** — Helius keyed primary applied; quiet smoke `RELEASE_OK` / `KEYED_SETTLE_PASS` (`KEYED_RPC_SETTLE_20260808T221310Z.md`). Order `7611b4a2-…` completed.
Wave 1 money path (buy→CONNECT→settle→withdraw) is now evidenced.  
**M1 load floor:** **PASS** vs live `https://api.proxyhubb.com` — `M1_product_load_20260808T223400Z.md` (http_fail 1.78%, browse p95 ~36ms, ~60 req/s). Map rate-limit (30/min) documented.  
**Invite packaging:** **Live** — Testnet/devnet banner + Help honesty + journal alert soft-pedal (`INVITE_PACKAGING_20260808T224200Z.md`).  
**GHCR web:** **Redeployed** `invite-pack-20260808` (`GHCR_WEB_REDEPLOY_20260808T225500Z.md`) — emergency build replaced.  
**CONNECT soak:** **PASS** — 202/202 @ ~3 rps under session RPM cap (`M1_CONNECT_soak_20260808T231008Z.md`; edge `max_rpm_per_session=300`). Limited cohort invites OK.  
**GW-08 metering:** **PASS** — seq/pending/spill/unique-nonce evidenced live (`GW08_metering_20260809T120705Z.md`).  
**EV-01 treasury JetStream:** **PASS** — stream + durable consumer + publish→ack (`EV01_treasury_jetstream_20260809T123137Z.md`).  
**M2 Redis HA:** **PASS** — Sentinel + HAProxy failover on-VM (`M2_redis_ha_20260809T135920Z.md`). Memorystore deferred (cost / Phase B).  
**PHASE-A SPOF:** **ACCEPTED** — single-VM Compose for limited invites (`PHASE_A_SPOF_ACCEPTANCE_20260809T140300Z.md`). Phase B exit = multi-host + managed PG/Redis + worker election.  
**DB-01 dual-write:** **PARTIAL↑** — 2100 catch-up + skip allowlist + `PROXYHUB_JOURNAL_DRIFT_ALERTS=1` (`DB01_dual_write_harden_20260809T141313Z.md`). Wallet remains SoT; **M4** journal-as-SoT still open.

Companion canvas: open `testnet-production-readiness.canvas.tsx` beside chat.

---

## Definition of done (production-quality Testnet)

1. Money credibility — treasury deficit + journal drift cleared or explicitly sandboxed with banners  
2. Operator visibility — durable `ops_alerts` + NATS + Grafana internal webhook (no SaaS Slack/PD)  
3. Happy path proven — gated buy → CONNECT → meter → settle → withdraw evidence  
4. Recoverability — IMAGE_TAG rollback + DB restore drill evidenced  
5. Load floor — k6/CONNECT vs live with published SLO result  
6. Honesty — no trustless/HA/mainnet marketing; ZK = oracle-attested until Groth16  

---

## P0 — Before wider invites

| ID | Work | Why |
|----|------|-----|
| TRIAGE-01 | Resolve ~**2.19 SOL** deficit + journal drift (`fe793802…`) — was ~9.4 stale | Balances not credible |
| S3 | Platform-native alerts (`ops_alerts` + NATS + Grafana webhook); **no Slack/PD** | Operator visibility without SaaS |
| M4 | Journal as SoT / integer lamports E2E | Dual-write drift class |
| E2E-01 | Full gated marketplace e2e on live | Smoke settle ≠ full FSM |
| S8 | Rollback + backup restore drill | **PASS** evidence `S8_dr_20260808T175337Z.md` |

## P1 — Always-on reliability

| ID | Work |
|----|------|
| M1 | Product load suite vs live — **PASS** (`M1_product_load_20260808T223400Z.md`) |
| GW-08 | Metering WAL durability / idempotency — **PASS** (`GW08_metering_20260809T120705Z.md`) |
| EV-01 | Treasury JetStream stream — **PASS** (`EV01_treasury_jetstream_20260809T123137Z.md`) |
| M2 | Redis HA / Memorystore — **PASS** on-VM Sentinel+HAProxy (`M2_redis_ha_20260809T135920Z.md`); Memorystore = paid upgrade |
| DB-01 | Double-entry + immutability (XL) — **PARTIAL↑** dual-write harden (`DB01_dual_write_harden_20260809T141313Z.md`); M4 SoT still open |
| PHASE-A | Exit or formally accept single-VM SPOF — **ACCEPTED** (`PHASE_A_SPOF_ACCEPTANCE_20260809T140300Z.md`); Phase B exit criteria in that doc |

## P2 — Product completeness

| ID | Work |
|----|------|
| 1.2 | Entitlement + concurrency/RPM at CONNECT |
| 1.3 | Provider failover |
| GW-04 | ISP routing or remove claim |
| API-01 / FE-05 | `/v1/network/status` |
| FE-06/07 | Remove hardcoded trust stats |
| FE-02 | Authenticated WS in deploy |
| 1.11 | HTTP proxy or CONNECT-only docs |
| ZK-PROVER | Enable prover profile when CPU budget allows |

## P3 — Decentralization / mainnet track

| ID | Work |
|----|------|
| BC-11-B | BN254 Groth16 on-chain verify |
| BC-11-C | Real reputation program deploy |
| DISC-01 | Decentralize discovery/entitlement |
| BC-09 | Residual key hygiene |

---

## Already done (do not re-open)

Security P0s · BC-05/06/07/08/13 · challenge window · custody KMS · BC-11 Phase-1 + Sprint A · on-box Prometheus/Grafana · edge health fix.

---

## Suggested waves

1. **Days:** S3 (platform alerts) → money triage **resolve** → e2e CONNECT pack → S8  
2. **1–2 weeks:** M1 load → GW-08 → EV-01 → M2 Redis  
3. **Ongoing:** entitlement/failover/FE honesty · zk-prover enable  
4. **XL / mainnet:** ledger SoT · Groth16 · multi-VM HA  

Mainnet still requires audit Phases 2–4 + security re-review; this list is for **Testnet as production environment**.
