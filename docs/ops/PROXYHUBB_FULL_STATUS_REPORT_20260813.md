# ProxyHubb full status report

| Field | Value |
|-------|--------|
| **Snapshot date** | 2026-08-13 |
| **Purpose** | One place to remember what shipped, what improved, how decentralized the product actually is, and what is still open |
| **Environment** | Live GCP Compose on Solana **devnet** (not mainnet) |
| **Stance** | Federated hybrid marketplace. **Not DePIN.** `programs/session` stays undeployed. |

This report is a **tracking snapshot**, not a marketing claim. Slice-level proof lives under [`evidence/`](evidence/). Wave plans are the source of exit criteria. If this file and an evidence pack disagree, **believe the evidence pack**.

Prior snapshot (security + Phase-A testnet, before Waves 2–9): [`ProxyHubb_Progress_and_Testnet_State_Report_2026-08-08.md`](ProxyHubb_Progress_and_Testnet_State_Report_2026-08-08.md).

---

## 1. Executive verdict

ProxyHubb is a **working Solana-devnet marketplace** (listings, escrow, CONNECT/SOCKS egress, oracle settle) that has spent Waves 1–9 making coordination **less single-process and less single-table**, without becoming a trustless network.

| Question | Honest answer |
|----------|----------------|
| Can buyers browse, pay, and CONNECT on testnet? | **Yes**, on a scripted, monitored, limited-audience Testnet. |
| Is it HA / mainnet / investor-grade books? | **No.** Single control-plane, treasury alerts have fired, accounting is sandbox-grade. |
| How decentralized is it? | **Federated hybrid ~3.2 / 5.** Two hosts, on-chain registry/Groth16/escrow, reconstructible bundles. Default CONNECT still HMAC + Redis. Catalog merchandising still Postgres. Same GCP org. Live slash **false**. |
| Is it DePIN? | **No.** Do not say DePIN, trustless residential egress, or on-chain store. |
| Biggest leftover for marketplace autonomy | Live **ListingCommitment** program upgrade (W9.A) plus a **foreign-org** operator (W7.D). |

**Bottom line:** A lot of real protocol and ops work landed. The product is a **company-coordinated federated proxy marketplace with cryptographic receipts**, not an ownerless network. Default live flags after soaks go **back to off**. That is intentional.

---

## 2. What ProxyHubb is today

### Product

Buyers discover residential/proxy listings, fund via Solana (deposit vault / escrow PDA), activate a session, and CONNECT through an edge gateway. Providers tunnel into gateways. An oracle (GCP KMS) attests usage and settlement. Groth16 batches bind claimed usage **headers** on-chain; **bytes still come from the edge** (ADR 0010).

### Live topology (2026-08-13)

```text
Internet → Caddy TLS → api.proxyhubb.com (web + control-api)
         → edge CONNECT/SOCKS + provider tunnels

Host-A  proxyhubb-testnet     us-central1-a   35.255.62.196
        control-plane + J2 edges (edge-gateway-b soak target 127.0.0.1:18091)

Host-B  proxyhubb-w6-edge-b   us-west1-b      35.252.224.81
        same GCP org; Wave 7 binary not rolled; does not count as W7.D
```

Shared SoT on Host-A: Postgres, Redis, NATS, control-api. Host-B is a **second machine**, not a second company.

### Important program IDs

| Program | ID | Live status |
|---------|-----|-------------|
| `proxyhub` (escrow, registry, Groth16, BC-05/06) | `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu` | **Deployed on devnet.** Last successful *bytecode* is Groth16/BC-06. ListingCommitment ix **absent** on the dumped ELF. Data account was **extended** to 1,160,552 bytes during a failed W9.A write. |
| Reputation | `EnVE6ehKA2dYi69B3Lo8wt2wyDgzLw4tdtSEKoMYe5bF` | Deployed / consume + enforce (Wave 4.2). |
| Gateway bond (Wave 8) | `7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5` | **Localnet soak only.** Not a public-cluster slash. |
| `programs/session` | `8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb` | **Unsafe — do not deploy.** Unconstrained `slash_gateway`. |

### Custody (from S7 / Aug 8 inventory; still the live split)

| Role | Address |
|------|---------|
| Deposit vault | `8LZji2G9nn7ywoLwopgcREpm5xQHpvRJY1az1R9hHRzm` |
| Hot (KMS) | `FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3` |
| Oracle (KMS) | `8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2` |
| Cold | `3MrGGqkGKSfmgBBY8s537HX2Sk4zK4qCHCDdW3yGwCCZ` |
| Upgrade authority (cold, laptop) | `6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR` |

---

## 3. Default live honesty (after soaks restored off)

Public config after Wave 7 restore (`https://api.proxyhubb.com/v1/system/config/public`):

```
session_capability_mode=off
session_mint=control_api_hmac
redis_optional_connect=false
remaining_spof=control_api_hmac_and_redis
operator_org_diversity=same_org
discovery_sot=postgres
listing_commitment_mode=off
live_economic_slash=false
zk_onchain_groth16_ready=true
```

Capability issuer pubkey is left configured but unused while mode is off: `GG9tJqK1ZM2nSFruCWxuanLECvjJbveAWXrmvCiG8y8p`.

**How to read this:** soaks proved *capability*. Production defaults stay conservative. Claiming “sessions are decentralized” while this JSON says `off` would be false.

---

## 4. Things we have worked on (chronological)

### 4.1 Security, custody, and testnet hardening (through 2026-08-08)

Closed on the live VM (see the Aug 8 report + evidence packs):

- Public `/v1/health/nodes*` locked (was P0).
- Trusted-proxy / Caddy hygiene.
- Observability: Prometheus + Grafana on the VM.
- Redis HA-lite chaos **PASS**.
- Custody split + KMS oracle/hot; no oracle keyfiles in the app container.
- Flags: escrow PDA required, deposit finalized, vault UI/credit on, legacy treasury credit off.
- Money-path E2E: buy → pay → init → confirm → CONNECT → release (keyed RPC settle **PASS**).
- BC-05: usage-proof oracle bound to `program_state.admin`.
- BC-06: multisig settle (oracle + cosigner).
- BC-08 / S7: custody migrations **PASS**.
- Invite packaging + web GHCR redeploy.

**Known leftover from that era (may still be true; re-probe before treating as current):** treasury deficit alerts, journal drift on at least one wallet, dual-write mismatch. Testnet books are **not** investor-grade.

### 4.2 Wave 1 — Session PDA fail-closed

Marketplace activate fail-closes if the session PDA path is required and missing. Evidence: `W1_1_session_pda_failclosed_20260811.md`.

### 4.3 Wave 2 — Multipod data plane (same VM)

| Slice | What shipped | Claim |
|-------|----------------|-------|
| W2.1 | J2 two edge pods, sticky CONNECT, kill-one-pod | `SPRINT_J2_MULTIPOD_OK` live |
| W2.2 | Session hydrate / reaper durability | PASS |
| W2.3 | Cross-pod selection | PARTIAL |
| W2.4 | Multi-operator **design** (ADR 0007) | Design only |

Still one control-api / one host at that point.

### 4.4 Wave 3 — Discovery and entitlement less platform-erasable

| Slice | What shipped | Claim |
|-------|----------------|-------|
| W3.1 | `ProviderRegistry` gate on activate / smart-match (`observe` → **enforce** on testnet) | PASS |
| W3.2 | Browse honesty: offer hashes, catalog_source annotations | PASS |
| W3.3 | Order credential-proof **observe** stub | PASS (enforce came in W5.C.2) |
| W3.4 / 3.5 | Moderation appeals **API + ADR 0008**; delist still platform | Design + API |

Listings/map remained Postgres. Not an on-chain catalog.

### 4.5 Wave 4 — Groth16, reputation, incentives stub, governance

| Slice | What shipped | Claim |
|-------|----------------|-------|
| W4.1 | On-chain Groth16 (`alt_bn128` / `groth16-solana`), live lane `groth16-bn254-batch-digest-v2` | **Live on testnet** |
| W4.2 | Reputation program deploy + consume + registry enforce | **Live** |
| W4.3 | Protocol incentives **observe** stub | PASS (settle dual-gate in W5.C.4) |
| W4.4 | Governance autonomy (proposals; treasury execute still gated) | PASS as scoped |

Metering still trusted-relay at the edge. Groth16 verifies a **digest**, not physical packets.

### 4.6 Wave 5 — Usage binding, multi-operator (same host), catalog/money flags

| Slice | What shipped | Claim |
|-------|----------------|-------|
| W5.A | batch-digest-v2 leaf commitment in Groth16 public digest (ADR 0010) | OPS COMPLETE |
| W5.B | Operator discovery API + peer-forward CONNECT soak; slash **hooks** observe | PASS (same VM) |
| W5.C.1 | Browse omits unregistered providers when filter enforce | PASS |
| W5.C.2 | HMAC credential proof **enforce** on marketplace CONNECT | PASS (still platform HMAC) |
| W5.C.3 | Dual-gated governance treasury hot-wallet execute | PASS; gcp default off |
| W5.C.4 | Dual-gated protocol incentive settle | PASS; gcp default observe/off |
| W5.C.5 | ListingCommitment **source** + Go client + PG mirror + honesty | Code PASS; **live PDA deploy leftover → Wave 9.A** |

### 4.7 Wave 6 — Second host

| Slice | What shipped | Claim |
|-------|----------------|-------|
| W6.A | Host-B `proxyhubb-w6-edge-b` (us-west1-b) | **two_hosts** live |
| W6.B | Operator-attested discovery manifests | PASS |
| W6.C | Cross-host peer-forward soak | PASS |
| W6.D | Bond-enforce design; observe audit; **rejected** session-program slash | Design PASS; live slash false |

Host-B is **same GCP project**. That is two machines, not two orgs.

### 4.8 Wave 7 — Federated session verify (claimed A–C live)

| Slice | Marker | Live? |
|-------|--------|-------|
| W7.A | `W7A_API_DOWN_CONNECT_OK` — Ed25519 capability; CONNECT after control-api stop on Host-A J2 edge-b | **Yes** (soak). Default restored **off**. |
| W7.B | `W7B_BUNDLE_VERIFY_OK` — signed operator bundle without Postgres/API | **Yes** (verify path). HTTP `/bundle` export not live. |
| W7.C | `W7C_REDIS_DELETE_CONNECT_OK` — Redis session blob optional for that admission | **Yes** (soak). Default restored HMAC+Redis. |
| W7.D | `W7D_JOIN_CLI_OK` in-repo; live foreign VPS | **Join CLI only.** `operator_org_diversity=same_org`. |

Evidence: [`W7_CLAIMED_20260813.md`](evidence/W7_CLAIMED_20260813.md).

### 4.9 Wave 8 — Safe bonded gateway slash (localnet)

Replaced the forbidden session `slash_gateway` with `programs/gateway-bond`: stake → accuse → **minimum 3600s window** → slash to treasury or release. Rent floor. No session program.

| Slice | Status |
|-------|--------|
| W8.A–C | Code + dual-gate API + ADR 0014 |
| W8.D | `W8D_BOND_SLASH_OK` **localnet** |
| GCP execute | **Unclaimed.** `live_economic_slash=false` |
| Public-cluster `.so` | Unclaimed (Windows cannot emit BPF easily; soak used native `solana-program-test`) |

### 4.10 Wave 9 — Catalog/settlement copies (in progress 2026-08-13)

Goal: Postgres is not the **only** listing-commitment set or settlement receipt. Not an on-chain shop.

| Slice | Status |
|-------|--------|
| W9.A | **Local SBF soak PASS** (`W9A_LISTING_COMMITMENT_SOAK_OK`). Laptop `.so` has ListingCommitment **and** Groth16 (sha256 `4DC0D0A5…925B`). Live ELF still Groth16-only. Devnet upgrade **blocked** on RPC buffer writes (public RPC + Helius 429). Program data **resized** to 1,160,552; executable bytes **not** replaced. |
| W9.B | Unit PASS — signed listing-commitment bundle; `GET /v1/listings/commitments/bundle`; CLI verify |
| W9.C | Unit PASS — portable settlement receipt; `WouldBroadcast()` always false |
| W9.D | Local PASS (`W9D_API_DOWN_RECONSTRUCT_OK`) with API down. GCP `docker stop` of control-api **unclaimed**. |

Without live PDAs, W9.B is a **signed dump of Wave 3.2 offer hashes** (`on_chain=false`).

---

## 5. Things we have improved and enhanced

Grouped by *buyer-visible* vs *protocol/ops*. “Improved” here means a stricter or more honest path than the previous week, not “decentralized.”

### Protocol and cryptography

- Session activate can fail-close on missing session PDA.
- ProviderRegistry is a real gate (`enforce`), not only a heartbeat toy.
- Usage batches: Groth16 on-chain verify **plus** digest-v2 binding of ordered leaf hashes.
- Reputation consume from ZKBatchPDA / registry.
- Escrow PDA + deposit-finalized flags on the money path.
- Oracle bound on-chain (BC-05); multisig settle (BC-06).
- ListingCommitment instruction **exists in source** and in a rebuilt `.so`; not yet on live ELF.
- Bonded slash with a challenge window **exists and moved lamports on localnet**.

### Marketplace honesty (stop lying in the API)

Public config and listing/discovery metadata now name:

- catalog source (postgres vs pinned bundle cache)
- listing commitment mode
- session mint / capability mode
- operator host diversity vs org diversity
- `live_economic_slash=false` until a live execute soak
- `programs_session=unsafe_do_not_deploy`

That is an enhancement: **the product can describe its own SPOFs**.

### Operations and resilience

- Health endpoints no longer publicly dump the fleet.
- Prometheus/Grafana on Host-A.
- Redis HA-lite drill.
- J2 two edge processes on one VM; then a **second VM** in another region.
- Keyed Helius RPC on GCP for settle (deploy-sized writes still 429 on that key).
- Dual-gates on anything that **sends SOL** (treasury execute, incentive settle, slash execute, settlement broadcast).

### Reconstruct-without-API (federated copies)

| Artifact | Verify without live API? | Notes |
|----------|---------------------------|--------|
| Operator discovery bundle (W7.B) | Yes (CLI) | HTTP export not live |
| Listing-commitment bundle (W9.B) | Yes (CLI + local W9.D) | Hashes; PDAs mostly `on_chain=false` |
| Settlement receipt (W9.C) | Yes (CLI) | Observe-only; no broadcast |
| Capability CONNECT (W7.A/C) | Yes **when mode on** | Default **off** after soak |

Title, media, search, delist, new orders, merchandising: still the API/Postgres.

---

## 6. Current state scorecard

### 6.1 Decentralization (honest)

Think in **layers**. Waves moved some layers; others are still a company.

| Layer | Then (≈ Aug 8) | Now (Aug 13) | Still centralized? |
|-------|----------------|--------------|---------------------|
| TLS / public API | One Caddy + control-api | Same | Yes — Host-A |
| Control plane | One VM | Same Postgres/Redis/NATS/API | Yes |
| Edge processes | One gateway | J2 multipod + Host-B | Partially — two machines, one org |
| Session mint | HMAC + Redis only | Capability **exists**; default HMAC + Redis | Yes in default |
| Session verify | Redis required | Can be capability-only (soak) | Default still Redis |
| Provider selection | Platform DB | Registry **enforce** + browse filter | Hybrid |
| Catalog index | Postgres | Postgres + signed hash bundle | Yes for shop UX |
| Listing commitments on-chain | Code | Local PDA soak; live ELF missing ix | Yes (live) |
| Usage bytes | Edge attested | Same + stronger batch digest | Yes (ADR 0010) |
| Usage batch on-chain | Oracle Merkle / Groth16 path | Groth16 live + digest-v2 | Hybrid |
| Settlement copy | Postgres + chain push | Portable receipt (observe) | Postgres still working copy |
| Gateway stake/slash | Audit rows `tx_hash=""` | Localnet bonded program | Live slash false |
| Operator identity | Platform | Same org Host-A/B | `same_org` |
| Governance / treasury | Ops + gated hot wallet | Dual-gated execute exists | Not a DAO CPI |
| `programs/session` | Unsafe | Still undeployed | N/A (correct) |

**Numeric (for tracking only, not a press score):**

| Scale | Aug 8 report | Aug 13 this snapshot |
|-------|----------------|----------------------|
| Testnet readiness | ~6.4 / 10 controlled Testnet | ~6.8 / 10 — more soaks, still not HA |
| Decentralization | ~2.5 / 5 hybrid | **~3.2 / 5 federated hybrid** |
| Wave-ladder marketing (W3–W4 docs said ~4.2–4.5) | Inflated vs audit | **Do not use wave-ladder numbers in public** |

~3.2 means: cryptographic receipts and a second host exist; **killing Host-A control-api still kills new orders, default sessions, merchandising, and in-flight workers**. Capability CONNECT is a **gated soak**, not the default product.

### 6.2 Remaining SPOFs (the actual backlog)

If Host-A control-api dies:

- Default: **no new sessions** (HMAC mint + Redis).
- Soak mode: existing capability tokens can CONNECT on the soaked J2 edge; Host-B image may be stale.
- **No listings shop** (Postgres). W9.D reconstructs **hashes/receipts**, not checkout.
- Settlement workers die; chain copy is not the runtime ledger.

If Redis dies (default flags): CONNECT dies. W7.C soak showed it **need not**, when capability mode is on.

If the oracle/KMS dies: attest/settle fail-closed (by design).

If public/Helius RPC 429s: program **upgrades** fail; settle may still work on a quieter key path.

### 6.3 What “done a lot” bought us

We did **not** lose the plot. The through-line is:

1. Stop shipping P0 security holes on a public Testnet.
2. Bind money and attestations to chain accounts the platform does not casually forge.
3. Split the **data plane** across processes, then machines.
4. Make session **verify** and discovery **copies** portable, then turn defaults back off.
5. Build a **safe** slash vehicle instead of deploying the unsafe session program.
6. Start copying **catalog commitments and settlement receipts** off Postgres.

Each wave’s leftover is named in the next plan (W5.C.5 → W9.A, W6.D → W8, W6 same-org → W7.D). That is the tracking system. This file is the index.

---

## 7. What we still need to work on

Ordered by “stops us claiming the next honest milestone,” not by excitement.

### P0 — Do not regress

- Never deploy `programs/session`.
- Never claim DePIN, trustless metering, or on-chain catalog.
- Keep dual-gates on SOL sends; gcp slash execute off.
- Rotate the Helius key that Solana CLI printed into a local deploy log (2026-08-13); update Secret Manager `proxyhubb-testnet-solana-rpc-url` and Host-A `.env`.
- Upgrade authority stays on the **laptop**, not the app VM.

### P1 — Finish Wave 9.A live (marketplace copy on-chain)

Blocker: **keyed RPC that can write ~1.1MB program buffers** (current Helius key 429s on `program deploy`; public devnet timed out).

Then, in order:

1. `CONFIRM_W9A_UPGRADE=1` on **devnet only** with the ListingCommitment+Groth16 `.so` (`4DC0D0A5…925B`). Confirm dumped ELF greps `Listing commitment registered` **and** `Groth16`.
2. `CONFIRM_W9A_LIVE=1` register soak → PDA + optional PG `listing_commitment_on_chain`.
3. gcp default may stay/return **off**.
4. Re-emit W9.B bundles with `on_chain=true` where PDAs exist.

Laptop artifact is already rebuilt. Program data account is already **large enough**.

### P2 — Wave 7 leftovers (federation that is not the same company)

- Live **foreign VPS** (`CONFIRM_W7D_EXTERNAL_VPS=1`) so `operator_org_diversity=multi_org`.
- Apply live DB migration `000151` (`org_id`) if CLI reconstruct should match production schema.
- HTTP operator `/bundle` on control-api.
- Roll **Host-B** to the Wave 7 edge binary (today it does not count as W7).

### P3 — Wave 8 live slash (economics, still not DePIN)

- Build/deploy `gateway-bond` `.so` on a public cluster (not session).
- Observe-only on GCP until an explicit execute soak.
- Keep `live_economic_slash=false` until that soak is evidenced.

### P4 — Wave 9.D / ops soaks

- Gated `CONFIRM_W9D_STOP_API=1` on Host-A (do not confuse with “shop works without ProxyHubb”).
- Keep C in parallel: settlement receipts remain observe-only.

### P5 — Product / money hygiene (from Aug 8, re-verify)

- Treasury deficit / journal drift / dual-write alerts.
- Slack (or equivalent) money-alert triage before a wider invite.
- Always-on SLO / multi-control-plane HA — **not started**; Phase-A accepted single-VM SPOF.

### P6 — Explicitly out of scope until a later ADR

- Trustless residential egress / TEE metering.
- Censorship-resistant merchandising CDN.
- Mainnet as a substitute for decentralization.
- DAO treasury CPI replacing dual-gated hot wallet.

---

## 8. Suggested next implementation order (already agreed)

Wave 9: **A → B → D, with C in parallel after A.**

A is the live program upgrade. B and D are already unit/local PASS but tell the truth (`on_chain=false`) until A lands. C is observe-only and can stay that way.

Wave 8 already points at Wave 9 for catalog/money copies. W7.D and W8 public-cluster slash remain **open ops**, not Wave 9 exit.

---

## 9. ADR index (decisions we must not forget)

| ADR | Title | Why it matters |
|-----|--------|----------------|
| 0005 | Marketplace catalog layer | Listings UX is a layer on top of commitments |
| 0006 | Order status FSM | Money states |
| 0007 | Multi-operator gateways | Multipod ≠ multi-operator |
| 0008 | Moderation appeals | Delist stays platform |
| 0009 | Governance autonomy | Treasury not magic DAO |
| 0010 | Trust-minimized metering | Edge still byte SoT |
| 0011 | Listing commitment PDA | Hash anchor, not a shop |
| 0012 | Independent gateway operators | Host vs org diversity |
| 0013 | Federated session mint | Capability vs HMAC |
| 0014 | Bonded gateway slash | Safe slash; not session |

---

## 10. Evidence index (2026-08-08 → 2026-08-13)

Security / custody / E2E: `S3_*`, `S7_*`, `S8_*`, `BC05_*`, `BC06_*`, `BC08_*`, `BC11_*`, `KEYED_RPC_SETTLE_*`, `E2E_*`, `M1_*`, `M2_*`, `TRIAGE01_*`.

Waves 1–4: `W1_1_*`, `W2_*`, `W3_*`, `W4_*`.

Waves 5–6: `W5_A_*`, `W5_B_*`, `W5_C_*`, `W6_A_*` … `W6_D_*`.

Waves 7–9: `W7_CLAIMED_*`, `W7_A_*` … `W7_D_*`, `W8_A_*`, `W8_D_*`, `W9_A_*`, `W9_B_*`, `W9_C_*`, `W9_D_*`.

W9.A live upgrade attempts: [`W9_A_listing_commitment_soak_20260813.md`](evidence/W9_A_listing_commitment_soak_20260813.md) (local PASS), [`W9_A_upgrade_rpc_blocked_20260813.md`](evidence/W9_A_upgrade_rpc_blocked_20260813.md) (live BLOCKED).

---

## 11. One-page cheat sheet

```
SHIPPED LIVE (devnet Testnet)
  custody split, KMS oracle, escrow flags, BC-05/06
  Groth16 lane + digest-v2
  ProviderRegistry enforce + browse filter
  J2 multipod + Host-B second machine (same org)
  Wave 7 A–C soaks (then flags restored off)

SHIPPED IN-REPO / LOCALNET ONLY
  capability session (default off)
  signed operator + listing + settlement bundles
  gateway-bond slash with 3600s window
  ListingCommitment .so + ProgramTest PDA

NOT SHIPPED / DO NOT CLAIM
  live ListingCommitment PDA
  foreign-org operator
  live economic slash
  Host-B Wave 7 roll
  programs/session
  DePIN / trustless bytes / on-chain store
  mainnet
```

When someone asks “are we decentralized yet?” the accurate sentence is:

> ProxyHubb is a federated hybrid marketplace on Solana devnet: two hosts in one org, on-chain registry and Groth16 batches, reconstructible signed receipts, and optional capability CONNECT. Default production still mints HMAC sessions through one control-api. It is not a DePIN.

---

*End of snapshot 2026-08-13. Update this file when W9.A live, W7.D foreign VPS, or W8 public-cluster slash changes a row above.*

Roadmap toward a decentralized marketplace and a DePIN **gate** (not a claim):
[`WAVE10_DEPIN_AND_MARKETPLACE_ROADMAP.md`](WAVE10_DEPIN_AND_MARKETPLACE_ROADMAP.md).
