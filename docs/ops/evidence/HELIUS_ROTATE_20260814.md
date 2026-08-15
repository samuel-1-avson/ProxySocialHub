# Evidence: Helius key rotation — 2026-08-14

## Verdict

**PASS** — `HELIUS_ROTATE_SM_OK` + `KEYED_RPC_APPLIED_SKIP_SETTLE`.

Replacement key minted in the Helius dashboard (Collarheather, 14 Aug 2026).
Payload never printed. Upgrade authority stayed on the laptop:
`6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR`.

## Secret Manager

| Item | Value |
|------|--------|
| Secret | `proxyhubb-testnet-solana-rpc-url` |
| v2 | **enabled** 2026-08-14T10:43:43Z (new keyed **devnet** URL) |
| v1 | **disabled** 2026-08-08 (old URL) |
| Host | `devnet.helius-rpc.com` (query not printed) |
| Probe | `getHealth=ok`; Host-A `getLatestBlockhash` slot `483772456` |
| VM SA accessor | `108687509435-compute@developer.gserviceaccount.com` `secretAccessor` (policy was empty; granted this soak) |

## Host-A

- `.env` backup `.env.bak.keyed-rpc-20260814105102`
- Recreate **without** `--remove-orphans`
- Compose: `docker-compose.yml` + `testnet` + `gcp-testnet` +
  `w6-host-a-private.yml` + `w10-observe.yml`
- `control-api` healthy; `/health` `{"status":"ok"}`
- `PROXYHUB_SESSION_CAPABILITY=observe`
- `GATEWAY_OP_A_HOST_ID=gce-proxyhubb-testnet`
- `GATEWAY_OP_B_HOST_ID=gce-w6-operator-b`
- `SKIP_SETTLE=1` (no SOL send)

Public honesty still:

```
session_capability_mode=observe
session_mint=control_api_hmac
live_economic_slash=false
operator_org_diversity=same_org
discovery_sot=postgres_cache
```

## Operator action (dashboard)

Disable every Helius key **except** Collarheather. This environment cannot
disable dashboard keys. Do not disable Collarheather until a further rotate.

## Non-claims

- Not a write-buffer / program-upgrade soak
- Not live economic slash
- Not DePIN
- Upgrade authority was **not** copied to GCP or Secret Manager
