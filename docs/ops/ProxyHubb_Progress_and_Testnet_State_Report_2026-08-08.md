# ProxyHubb Progress & Testnet State Report

| Field | Value |
|-------|-------|
| **Report date** | 2026-08-08 |
| **Baseline** | [ProxyHubb_System_Audit_and_Testnet_Readiness_Report.md](../../ProxyHubb_System_Audit_and_Testnet_Readiness_Report.md) (same-day hybrid audit) |
| **Environment** | Live GCP Compose — `proxyhubb-testnet` (Solana **devnet**) |
| **Method** | Code remediations + on-VM deploy/chaos/evidence packs + live public probes |
| **Companion evidence** | `docs/ops/evidence/S3_observability_*.md`, `docs/ops/evidence/S7_custody_migrations_*.md` |

---

## 1. Executive verdict

ProxyHubb has moved from **“partially ready with open P0 security regressions”** to **controlled Testnet-ready with known Phase-A limits**.

| Question | Answer |
|----------|--------|
| New progress / state? | Week-0 security hotfixes are **live**; money-path custody evidence **PASS**; observability stack **on**; Redis HA-lite chaos **passed**; edge is **healthy**. |
| How improved? | Material gains in security hygiene, custody proof, resilience drills, and ops visibility — not yet HA or mainnet-grade. |
| Testnet readiness? | **~6.4 / 10 — Controlled public Testnet OK** (devnet, accepted single-VM SPOF). Not ready for always-on SLO or mainnet capital. |
| Decentralization? | Still **~2.5 / 5 — hybrid marketplace**. BC-05 attest binding + BC-06 multisig settle live; discovery, metering authority, and entitlement remain centralized. |

**Bottom line:** Safe to run a **scripted, monitored, limited-audience Testnet** on devnet. Do **not** market as trustless, HA, or mainnet-ready. Close Slack alerting + money-alert triage before a wider invite.

---

## 2. Current system state (live)

### Topology (unchanged Phase A)

```text
Internet → Caddy TLS → web (:3000) + control-api (:8080)
         → edge-gateway CONNECT/SOCKS (:8090) + tunnels (:3128)
Single GCE VM: Postgres · Redis · NATS JetStream · (now) Prometheus/Grafana
Solana: devnet · GCP Cloud KMS oracle + hot · deposit vault PDA
```

### Live probes (2026-08-08)

| Probe | Result |
|-------|--------|
| `/v1/system/config/public` | `destination_kind=vault`, deposit/vault `8LZji2G9…` |
| `/v1/health/nodes` (public) | **404** (locked down; was P0 exposure) |
| Prometheus `/-/ready` | **200** (`127.0.0.1:9091`) |
| Grafana `/api/health` | **200** (`127.0.0.1:3001`) |
| Edge compose health | **healthy** (HEAD/GET `/health` fixed) |
| control-api / edge | Recreated from audit-hardening builds; healthy |

### Custody inventory (S7 evidence — PASS 20/20)

| Role | Address | Notes |
|------|---------|-------|
| Deposit vault | `8LZji2G9nn7ywoLwopgcREpm5xQHpvRJY1az1R9hHRzm` | UI destination |
| Hot (KMS) | `FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3` | ≠ vault/oracle/cold |
| Oracle (KMS) | `8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2` | Fail-closed GCP KMS |
| Cold | `3MrGGqkGKSfmgBBY8s537HX2Sk4zK4qCHCDdW3yGwCCZ` | ≠ hot |

Flags confirmed live: `PROXYHUB_REQUIRE_ESCROW_PDA`, `PROXYHUB_DEPOSIT_REQUIRE_FINALIZED`, vault UI/credit on, legacy treasury credit off, no oracle/hot file keypaths in container.

### Money-path alerts currently firing (ops debt)

These are **visible and correct signals**, not silent failures:

- Treasury deficit ~**9.4 SOL** (liabilities ≫ on-chain backing)
- Per-wallet journal drift on `fe793802-…` (~7.6 SOL dual-write mismatch)
- Wallet ledger vs DB discrepancy (~87k lamports on same wallet)

**Implication:** Testnet can run, but treat balances as **sandbox/devnet accounting under repair**, not investor-grade books.

---

## 3. Progress since the baseline audit (same day)

### Closed / landed on live VM

| ID | Item | Status |
|----|------|--------|
| S1 / SEC-R1 | Lock `/v1/health/nodes*` behind admin | **Live** (public 404) |
| S2 | `ConfigureTrustedProxies` (loopback/Caddy default) | **Live** |
| S4 | Rewrite broken k8s `deploy.yml` → GHCR-oriented path | **In repo** |
| S5 | Session usage ownership check (IDOR) | **Live** |
| S6 | Bulk HMAC fail-closed outside dev | **Live** |
| S3 (stack) | Prometheus + Grafana + redis-exporter profile | **Live** (localhost-bound) |
| S3 (channels) | Slack / PagerDuty delivery | **PARTIAL** — no webhook/key yet |
| S7 | Migrations 000116/124/137/138 + custody/KMS pack | **PASS** |
| Ops | BC-08 custody split (vault≠hot≠oracle≠cold) | **Live PASS** (`docs/ops/evidence/BC08_custody_split_*.md`) |
| Ops | BC-13 admin-cli CleanupDb guards | **Done** (`docs/ops/evidence/BC13_admin_cli_cleanup_guards_*.md`) |
| Eng-6 | Edge Redis fail-open RPM + hydrate; chaos drill | **Passed on VM** |
| Eng-8 | Per-wallet journal↔balance drift alerts | **Firing in logs** |
| Eng-9 | Escrow settle compensation outbox + NATS lag gauges | **Live** (`nats_*` on `/metrics`) |
| Ops | Edge healthcheck HEAD-vs-GET bug | **Fixed** (healthy) |
| Ops | `logging.Init()` so zerolog/alerts actually emit | **Fixed** |
| Ops | `/metrics` includes default Prometheus registry | **Fixed** (NATS gauges visible) |
| M7 (partial) | Admin payouts under admin JWT routes | **In repo / deployed with API** |
| M3 | BC-05 admin-bound usage/KYC attest + fail-closed settle | **Live on devnet** (slot `482106278`; see `docs/ops/evidence/BC05_upgrade_*.md`) |
| Phase B | Buyer challenge window + auto-release dispute gate | **Live** (`PROXYHUB_ESCROW_CHALLENGE_DAYS=7`; workers scheduled) |
| Phase B | BC-06 threshold/multisig settle | **Live** (slot `482124544`; release+auto-release+usage; `docs/ops/evidence/BC06_multisig_settle*_*.md`) |
| M3 (partial) | BC-07 finalized deposits | **Live `true`** |

### Still open (next gates)

| ID | Item | Why it matters |
|----|------|----------------|
| S3 finish | Wire Slack (and optional PD) | Deficit/drift alerts are log-only today |
| S8 | IMAGE_TAG rollback + backup restore drill | Rollback confidence not evidenced |
| M1 | Product k6/CONNECT load vs live | No SLO proof under load |
| M2 | Redis HA / Memorystore | Session/metering SPOF remains |
| M3 finish | Redeploy Solana program for BC-05 | On-chain attest still not bound until upgrade |
| M4 | Journal as source of truth / integer lamports E2E | Drift proves dual-write still incomplete |
| Triage | Resolve treasury deficit + journal drift | Credibility of Testnet balances |
| Phase A limit | Single-VM SPOF | Accepted for Testnet; blocks 99.9% claims |

---

## 4. How the system has been improved

### Security & abuse surface

**Before:** Public node inventory (IPs / provider IDs), spoofable `X-Forwarded-For`, session usage IDOR risk, bulk HMAC soft-fail in non-dev.

**After:** Node health admin-only; trusted proxies configured; ownership checks on usage; bulk HMAC fail-closed. These were the audit’s top *actionable* P0s and are no longer open on the live path.

### Custody & money path

**Before:** Audit already saw vault cutover starting; trust in live flags/migrations was incomplete.

**After:** Documented **20/20 S7 PASS** — vault destination, distinct vault/hot/oracle/cold, GCP KMS fail-closed for oracle + hot, finalized deposit requirement, escrow PDA requirement, ledger migrations + append-only trigger present. Settle retry outbox and NATS consumer lag gauges add operational depth around settlement.

### Resilience & edge data plane

**Before:** Redis treated as hard dependency for edge paths; healthcheck falsely unhealthy.

**After:** Chaos drill proved hydrate-after-eviction and process survival with Redis stopped; compose healthcheck now matches reality (GET `/health`, HEAD supported). Edge is a trustworthy “up” signal again.

### Observability

**Before:** Scorecard “on-box metrics / alerts = 3/10” — profile gated, unused.

**After:** Prometheus/Grafana running, all targets up, NATS lag rules installed, Grafana→control-api webhook path probed OK. Remaining gap is **external paging** (Slack/PD not configured).

### Engineering hygiene

- Deploy documentation path clarified away from broken EKS workflow.
- Product load test scaffolds exist (`testing/product_load.*`) — not yet executed as a live gate.
- Alerting package now initializes structured logging so Critical journal/treasury alerts are visible in journald/docker logs.

---

## 5. Testnet readiness scorecard (updated)

Baseline blended score from the morning audit: **~5.1 / 10**.

| Category | Was | Now | Notes |
|----------|----:|----:|-------|
| Topology honesty / SPOF awareness | 8 | 8 | Still Phase A single VM — correctly owned |
| Money-path fail-closed | 8 | **8.5** | S7 live evidence; residual accounting drift |
| Deploy forward path | 6 | **7** | Compose pull/build path exercised today |
| Rollback / blue-green | 3 | 3 | S8 drill **not** done |
| External uptime / smoke | 7 | 7 | Unchanged |
| On-box metrics / alerts | 3 | **6.5** | Prom/Grafana up; Slack still missing |
| Tracing | 1 | 1 | Unchanged |
| Backup / restore | 7 | 7 | Scripts exist; restore drill not re-run today |
| Load / SLO validation | 2 | 2.5 | Suites exist; not live-gated |
| Chaos / resilience | 2 | **5.5** | Redis HA-lite chaos passed on VM |
| Horizontal scale | 2 | 2 | Unchanged |
| Security hygiene | 3 | **7.5** | P0 health/nodes + trusted proxies closed live |
| **Blended (approx.)** | **~5.1** | **~6.4** | **Controlled Testnet ready** |

### Readiness gates

| Gate | Status | Comment |
|------|--------|---------|
| Controlled public Testnet (devnet, known SPOF) | **Ready with caveats** | Caveats: Slack, money-alert triage, invite size |
| Investor / partner scripted demo | **Ready** | Buy→CONNECT→settle path + custody story documented |
| Always-on 99.9% Testnet | **Not ready** | Single VM |
| Mainnet / real user capital | **Not ready** | Ledger SoT, BC-05 redeploy, HA, clean books |

---

## 6. Decentralization maturity (updated)

### Score

| Dimension | Morning audit | Now | Delta |
|-----------|--------------:|----:|-------|
| Settlement integrity | 3.5 | **3.9** | Escrow PDA + settle outbox; BC-05 usage-proof gate live |
| Custody | 3.0 | **3.6** | Live vault≠hot≠oracle≠cold + KMS fail-closed evidenced |
| Governance autonomy | 2.0 | 2.0 | Unchanged |
| Censorship resistance | 1.5 | 1.5 | Listings/admin still central |
| Token incentives | 1.0 | 1.0 | No live protocol tokenomics |
| Verifiable reputation / ZK | 1.0 | 1.0 | Unchanged (honest de-claim) |
| Data-plane neutrality | 2.0 | 2.0 | Many providers; few gateway operators |
| **Overall** | **~2.0 / 5** | **~2.2 / 5** | Still **hybrid**, not trustless |

### What improved (decentralization-relevant)

1. **Custody split is operational, not aspirational** — vault deposits, KMS oracle/hot, cold separation proven on the live box.
2. **Escrow / finalized deposit fail-closed flags** are on — less “custodial IOU by default” for the happy path.
3. **BC-05** admin-binding is **live on-chain** (usage proof / KYC attest); control-api refuses settle when usage-proof anchoring fails (`PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE=true`).
4. **BC-06** threshold multisig settle is **live** (nonce bump on-chain; amount-gated `escrow_multisig` + 2-of-N dual-sign on control-api).

### What did *not* change (still centralized)

- Listing discovery, moderation, map, entitlements → control-api + Postgres  
- CONNECT admission + session store → edge + Redis  
- Byte metering authority → gateway (by design for performance)  
- Withdrawal / treasury orchestration → platform + KMS  
- Governance execution / pause powers → admin/oracle  

**Honest market claim (unchanged, still correct):**  
*Solana-settled, wallet-native marketplace with progressive custody* — **not** “fully decentralized” or “trustless.”

---

## 7. Recommended next moves (priority order)

1. **Finish S3** — set `SLACK_ALERT_WEBHOOK_URL` (and optional PagerDuty); re-run `scripts/gcp-s3-enable-observability.sh`.
2. **Triage money alerts** — reconcile wallet `fe793802-…` and treasury deficit before broad Testnet invites.
3. **S8** — IMAGE_TAG rollback + backup restore drill; file evidence beside S3/S7.
4. **Phase B** — BC-06 / BC-08 / BC-13 closed. **BC-11 Phase-1** landed (submit wiring + FE de-claim); full on-chain Halo2 verify remains XL.
5. **M1** — run product load suite against live with JWT/CONNECT SLOs.
6. **M2 / M4** — Redis HA path + journal-as-SoT (closes the class of drift you are already detecting).

---

## 8. Summary table for reviewers

| Theme | State |
|-------|--------|
| Security P0s from morning audit | **Closed on live** |
| Custody / KMS / migrations | **Evidenced PASS** |
| Observability | **On-box ready; external alerts pending** |
| Edge resilience | **Chaos-proven HA-lite behavior** |
| Accounting integrity | **Alerts working; underlying drift open** |
| Testnet readiness | **~6.4/10 controlled Testnet** |
| Decentralization | **~2.5/5 hybrid** (BC-05 + BC-06 multisig settle live) |
| Mainnet | **Not ready** |

---

*Generated 2026-08-08 from hybrid audit baseline, VM remediations, and evidence packs under `docs/ops/evidence/`.*
