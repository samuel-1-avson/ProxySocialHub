# TRIAGE-01 Money triage classification — 2026-08-08

Companion to VM dump `TRIAGE01_money_20260808T174906Z.md`.

## Snapshot

| Item | Value |
|------|-------|
| Liabilities (Σ wallets) | **15.419956447 SOL** (almost all on `fe793802-…` / user `b77e84c9-…`) |
| Vault `8LZji2…` | **6.01 SOL** |
| Hot `Feunr…` | **7.2199904 SOL** |
| Cold `3MrGG…` | **5.171775 SOL** (not counted in deficit formula) |
| Combined vault+hot | **13.2299904 SOL** |
| Deficit (liab − vault−hot) | **≈ 2.190 SOL** |
| Prior “~9.4 SOL” figure | Stale / superseded by this re-measure |

Reconciliation code uses vault + hot only (`reconciliation.go` CombinedBackingSOL). Cold is reserve, not liability backing.

## Alert breakdown

### 1) Treasury deficit (~2.19 SOL) — REAL vs sandboxed
- On-chain vault+hot is short of DB liabilities by ~2.19 SOL.
- Dominant wallet is the ops/seller test account with large ledger credits (incl. recent +6 SOL).
- **Not** a hot/oracle key mishap; custody split addresses look correct (vault ≠ hot ≠ cold).
- Likely mix of: historical test credits, deposit watcher lag, and/or credits without matching vault inflow.

**Resolution options (need operator pick — no auto-mutation):**
1. **Top-up:** move ~2.2 SOL cold→vault (or oracle→vault) via approved custody path, then re-run recon.
2. **Write-down:** reduce `fe793802` balance/ledger by unbacked amount after audit of which credits lack tx refs.
3. **Sandbox banner:** keep as-is for invite-gated Testnet; surface “balances not fully reserved” in UI/ops until 1 or 2.

### 2) Journal per-wallet drift (~7.598 SOL) — DUAL-WRITE GAP
- Wallet balance 15.42 SOL; Σ journal `2100` for wallet = −7.8218444 SOL.
- Drift = `2100 + balance` = **7.598112047 SOL**.
- Ledger (hot) ≈ 15.4200444 SOL — nearly matches wallet (see #3).
- Journal dual-write never caught up for older/large credits; **ledger is SoT for this wallet, journal is incomplete**.

**Resolution options:**
1. Backfill balancing `2100` lines for missing dual-writes (scripted, idempotent, evidenced).
2. Treat journal as best-effort on Testnet; tighten alert threshold / only alert when both journal *and* ledger disagree with wallet.

### 3) Wallet vs ledger micro-drift (−87953 lamports)
- DB wallet **15.419956447** vs ledger **15.420044400** → wallet short by **0.000087953 SOL**.
- Noise-level; likely fee/rounding path.
- **Fix:** one adjusting ledger debit or bump wallet to ledger (prefer adjust wallet up 87953 lamports to match ledger SoT).

## Pending
Pending tx / payout queues not fully dumped in companion report; re-check before any write-down.

## Recommendation for Wave 1 close
1. **Do not** run `gcp-align-treasury-to-oracle.sh`.
2. Prefer **Option A top-up ~2.2 SOL to vault** for invite credibility, **plus** micro-drift fix, **plus** journal backfill or alert soft-pedal.
3. Keep cold as cold; do not fold cold into automatic deficit clearance without multisig/ops ticket.

## Blocked / waits
- Operator choice on deficit option (top-up vs write-down vs banner).
- Slack webhook still required to page these alerts off-box (S3).
