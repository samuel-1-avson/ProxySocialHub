# Evidence: W10.B listing-commitment observe left on — 2026-08-18

## Verdict

**PASS** — `W10B_LISTING_COMMITMENT_OBSERVE_LEFT_ON`.

After the 2026-08-17 Host-A control-api roll (binary has
`listing_commitment_sync`), `PROXYHUB_LISTING_COMMITMENT=observe` was set
and **left on**. Not restored off. Capability stayed `observe`. Slash
dual-gates unset. `live_economic_slash=false`. `operator_org_diversity=same_org`.
Delist stayed `platform_moderation`. Catalog stayed Postgres. Not a catalog
index. Not enforce. Not DePIN.

No listing was published in this step, so no new `RegisterListingCommitment`
tx was sent. Future shop publish/update may best-effort register (oracle
pays fees).

## Compose

Same five overlays as the roll, plus
`docker-compose.w10-listing-observe.yml`. Never `--remove-orphans`.
`.env` backup `.env.bak.w10b-listing-*`. `.env` has
`PROXYHUB_LISTING_COMMITMENT=observe`.

## Proof (Host-A + public API 2026-08-18)

```
PROXYHUB_LISTING_COMMITMENT=observe
PROXYHUB_SESSION_CAPABILITY=observe
GATEWAY_OP_A_HOST_ID=gce-proxyhubb-testnet
GATEWAY_OP_B_HOST_ID=gce-w6-operator-b
mode=observe commitments=ed25519_offer_hash+listing_commitment_pda catalog=postgres delist=platform_moderation
session_capability_issuer=operators_and_control_api
live_economic_slash=false
W10B_LISTING_COMMITMENT_OBSERVE_LEFT_ON
```

Public `https://api.proxyhubb.com/v1/system/config/public`:

```
listing_commitment_mode=observe
listing_commitments=ed25519_offer_hash+listing_commitment_pda
catalog_source=postgres
delist_authority=platform_moderation
session_capability_mode=observe
session_mint=control_api_hmac
remaining_spof=control_api_hmac_and_redis
```

Replay:

```
CONFIRM_W10B_LEAVE_OBSERVE=1 bash scripts/gcp-host-a-listing-commitment-observe.sh
```

## Non-claims

- Not enforce (listings without a PDA are still shown)
- Not a live register soak on a merchandised listing
- Not `programs/session`
