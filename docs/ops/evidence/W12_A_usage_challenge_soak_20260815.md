# Evidence: Wave 12.A usage-challenge **release** soak — 2026-08-15

## Verdict

**PASS** — `W12A_PETITION_VERIFY_OK` + `W12A_ACCUSE_OK` + `W11C_WINDOW_ELAPSED`
+ `W11C_RELEASE_OK`.

**Not claimed:** `live_economic_slash=true`, slash soak, buyer-to-chain
(slice 2), TEE, trustless metering, DePIN, `programs/session`.

## Exit claim

A verified W10.C settlement receipt was bound to a disputed `leaves_hash`
(ADR 0015 D1). The protocol accuser opened `gateway-bond` `accuse` with that
`evidence_hash`. After 3600s, `resolve_release` closed the challenge without
moving stake. Prefer release. Slash dual-gates stayed unset.

## Petition

| Field | Value |
|-------|--------|
| Receipt | Host-A `/opt/proxyhubb/ops/w10c-settlement-receipt.json` (`W9C_SETTLEMENT_RECEIPT_OK`) |
| `window_key` | `17c4b690-b860-4885-ae74-d0ca22560bb4:2026-08-09T12:00:00Z` |
| `settlement_sot` | `escrow_pda` |
| Disputed `leaves_hash` | `cdac3fc4404fa4f082fb897cd7f6e016e25c23be0e0e1a210968bfe1a16d2f6b` (`SHA256("PROXYHUB_W12A_SOAK_LEAVES:v1:" \|\| window_key)`) |
| D1 `evidence_hash` | `e8766b949fac25b22711c0c8bcf02332f3c5ae9acdbcc4455b2a7b69a8f7e884` |
| `resolve_path` | `release` |
| `would_broadcast` | false |

This disputes a **claimed** leaf digest, not physical bytes (ADR 0010).

## On-chain

| Field | Value |
|-------|--------|
| Program | `7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5` |
| Operator / accuser | `8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2` |
| Bond PDA | `H9a8FNvtRM5o7TWV9TVeaAvBiGGeXyNajUQ9Pgb8nbcq` |
| Challenge PDA | `JApaFv1qigB9ksEqiooGj9419E48cgu5XUZJQzWzjCYf` |
| Accuse tx | `rpyuDgpc4KsTSHFGasGNQk3xm6o9HdeZxWxQVBgoVdhQQt3moti1NZoLTarqjvoR4bKsBEaVANdRWUKbLJ7FjAa` |
| `resolve_after` | unix `1786786673` |
| `slash_bps` | 1 (cap only; `resolve_slash` not sent) |
| Release tx | `3Esiubh7SzRCxgXhduffcURbYckrcnh3szWGQcyn8WtGYbcAWzWJHVNFzoVHTQWnUypUfVwBnFWoEKpmcu4PKGni` |
| Stake after | 1_000_000 lamports |
| `open_challenge` / `accused` / `slashed` | false / false / false |
| `live_economic_slash` | **false** |

Post-release `fetch`: `challenge=missing`, `slash_count=0`.

## Honesty

- Accuser, operator, and admin are still the same oracle key (slice 1 SPOF)
- Bytes remain gateway-attested
- A usage challenge that **releases** is not economic slash
- W10.A observe unchanged

## Non-claims

- Not slice 2 (buyer-signed open without ProxyHubb as `config.accuser`)
- Not escrow clawback
- Not `resolve_slash`
- Not DePIN
