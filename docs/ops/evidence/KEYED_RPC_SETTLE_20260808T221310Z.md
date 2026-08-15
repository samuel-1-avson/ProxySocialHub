# Keyed Solana RPC + quiet settle — PASS

**When:** 2026-08-08T22:12–22:13Z  
**Host:** `proxyhubb-testnet` (us-central1-a, `gen-lang-client-0022105784`)  
**Network:** Solana **devnet**  
**Result:** `KEYED_SETTLE_PASS` / `RELEASE_OK`

## What changed

- Primary RPC set to Helius **devnet** keyed endpoint (`SOLANA_RPC_ENDPOINT` + first entry of `SOLANA_RPC_ENDPOINTS`).
- Fallbacks remain public: `api.devnet.solana.com`, OnFinality public.
- `control-api` force-recreated; health OK; env shows `https://devnet.helius-rpc.com/?api-key=***`.
- Quiet escrow smoke: buy → pay → init → confirm → CONNECT → release.

## Secret Manager note

- Secret `proxyhubb-testnet-solana-rpc-url` **v1** created in project SM.
- VM SA `108687509435-compute@developer.gserviceaccount.com` lacks `secretmanager.versions.access`, so apply used `KEYED_RPC_URL` via ephemeral file (not SM fetch).
- Follow-up: grant `roles/secretmanager.secretAccessor` on that secret to the VM SA (or workload identity), then re-apply via `SECRET=…`.

## Smoke IDs

| Field | Value |
|-------|--------|
| order | `7611b4a2-4f96-42ff-9186-8d72e81fd3ec` |
| listing | `c1472dbc-dee3-407e-8fea-ec3ed42489ac` |
| session | `97edda98-c63d-48ee-8125-edb53ea05588` |
| escrow PDA | `CZQHNe8JzNm2P6GtRR3ddSsx49DwFkd1fRqyjZxU2dDp` |
| init_tx | `41jjgmNG62ZTRF6KQu5Uf3ogHNMnN4GZFJzGyAxKoq7VUTVeVkKCtwxsky2gnpYsbMT6K3mwmZPDf8kpTXwbhAYS` |
| node | `4b60f9e2-11dc-4240-a332-6ec9f3669379` |
| buyer (ephemeral) | `GoiVPDjEJYz6WNYUqgaDioJZK4sUbH9kRPc2SW7KB879` |

## Proof markers

```
PROBE_OK
CONNECT_OK
CONFIRM_OK
RELEASE_OK
KEYED_SETTLE_PASS
KEYED_RPC_SETTLE_DONE
```

Order row after release: `status=completed`, `payment_method=solana_escrow`.

## Security

API key was shared in chat — **rotate the Helius key** after this proof and update SM + VM `.env`.
