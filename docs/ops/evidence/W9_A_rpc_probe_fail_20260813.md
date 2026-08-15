# Evidence: Wave 9.A RPC write-buffer probe — 2026-08-13 (evening)

## Verdict

**FAIL** — `W9A_RPC_PROBE_FAIL`. Live ListingCommitment upgrade **not** claimed.

`getHealth` is not enough. No endpoint completed a **1.16MB** `write-buffer` of
`proxyhub.so`. Program `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu` is
unchanged (slot `483522475`, ELF still Groth16-only). `programs/session` was
not deployed. GCP default stays **off**.

## Artifact (laptop, unchanged)

| Field | Value |
|-------|--------|
| Path | `services/solana-programs/proxyhub/target/deploy/proxyhub.so` |
| sha256 | `4DC0D0A5ACD3CAFE824D81AFE8D3F672D276AF39FE346E750A4BCAC9B673925B` |
| size | 1160552 |
| ListingCommitment | yes |
| Groth16 | yes |

## RPC probe

| Endpoint | getHealth | CLI `cluster-version` | 1.16MB write-buffer |
|----------|-----------|----------------------|---------------------|
| `api.devnet.solana.com` | ok | 4.2.0 | **FAIL** — allocated full-size buffer, copy did not finish; public RPC then `error sending request` |
| OnFinality public | ok | 4.2.0-rc.1 | **FAIL** — 429 under write load |
| GCP Helius (`proxyhubb-testnet-solana-rpc-url`) | ok | **429** | not used for write (CLI already 429) |
| Ankr public | unauthorized | n/a | skipped |

`--use-rpc --max-sign-attempts 15` did **not** unblock public writes.

## What happened on-chain

1. Treasury loaned **2 SOL** to oracle for buffer rent.
   Signature: `5gnimPHGfo7hjJdvVTMLS11U4D2AAaBb1NYWpQ6Uro8nB95iZbgEyg3MxDuF7p7ERHvTdqZXJE6zoY7KJ8HzWwme`
2. Public `write-buffer` created buffer `Aui8FsDhxuDkUZGZJNtydGm1GSxQnKp1Xx4sJAT29d3G`
   (~8.078 SOL, authority oracle). `--max-len` allocates full rent **before**
   data is copied — this was **not** a complete ELF.
3. Buffer was closed; loan repaid. No leftover buffers.
4. Program slot still `483522475`. Authority still
   `6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR`.

## Wallets after cleanup

| Account | Balance |
|---------|---------|
| Oracle `8P4uuapg…Kii2` | 7.89992266 SOL (~0.00035 SOL fees vs start) |
| Treasury `8g7WUuPo…ktU4` | 3.128565786 SOL (loan repaid) |
| Upgrade authority | ~0.044 SOL (not used as fee payer) |

## Blocker

Need a **paid / higher-limit keyed RPC** that can complete `solana program write-buffer` of ~1.16MB (Helius free-tier CLI 429; public and OnFinality drop under chunked writes). Rotate the existing Helius key (it has appeared in CLI 429 URLs). Do not copy upgrade authority to GCP.

Replay when that RPC exists:

```
CONFIRM_W9A_UPGRADE=1
RPC=<write-capable-keyed-devnet-rpc>
powershell -File scripts/w9a-rpc-probe-and-upgrade.ps1
```

Omit `--output json` next time so write progress is visible.

## Honesty

Not a catalog. Not DePIN. Not `programs/session`.
`listing_commitment_mode=off` on GCP.
