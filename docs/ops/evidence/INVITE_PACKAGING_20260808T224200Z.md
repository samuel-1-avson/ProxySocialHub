# Invite packaging + journal residual — 2026-08-08T2242Z

**Result:** Invite-honesty pack **live** on `proxyhubb.com`. Journal dual-write residual **accepted** for Testnet (logged, critical paging soft-pedaled).

## Deployed

| Change | Status |
|--------|--------|
| Global `TestnetEnvironmentBanner` (devnet / test SOL / single-server / not trustless) | **Live** (home + help HTML contain strip) |
| Help Center section “This is a Solana Devnet Testnet” | **Live** |
| `PROXYHUB_JOURNAL_DRIFT_ALERTS=0` on VM `.env` | **Set** — drift still logged, no critical page |
| control-api rebuild with alert gate | **Healthy** |
| Emergency web rebuild | **Healthy** (`ALLOW_EMERGENCY_WEB_BUILD=1`) |

## Residual money (re-measured)

| Item | Value |
|------|------:|
| Wallet `fe793802…` balance | **15.409956447 SOL** |
| Journal `2100` sum | **−7.811844400 SOL** |
| Dual-write drift | **+7.598112047 SOL** (unchanged class) |

Treasury surplus from earlier Wave 1 top-up remains; deficit triage is not re-opened. Journal dual-write gap was later cleared by DB-01 backfill (`DB01_dual_write_harden_20260809T141313Z.md`); **M4** (journal-as-SoT) remains open.

## Operator acceptance

For limited Testnet invites:

1. UI banner + Help copy disclose sandbox accounting / SPOF / hybrid model.
2. Journal dual-write historical gap on `fe793802` **cleared** 2026-08-09 (`DB01_dual_write_harden_20260809T141313Z.md`); `PROXYHUB_JOURNAL_DRIFT_ALERTS=1` re-enabled. M4 (journal-as-SoT) still open.
3. Do **not** auto write-down `fe793802` without an ops ticket.

## Follow-ups (optional)

- GHCR-tagged web redeploy to replace emergency image
- Helius key rotation (exposed in chat earlier)
- SM accessor for VM SA on `proxyhubb-testnet-solana-rpc-url`
- CONNECT load soak (M1 CONNECT scenario still skipped)
