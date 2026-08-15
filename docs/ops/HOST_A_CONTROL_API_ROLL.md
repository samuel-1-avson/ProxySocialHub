# Host-A control-api roll

**Scheduled: after the 2026-08-21 W10.A decision record. Do not run before it.**

The running Host-A binary was built 2026-08-14 and lags the repo. Until this
roll happens, three things are **in-repo only** regardless of any wave
checkbox:

| Missing on the live binary | Wave | Effect today |
|---------------------------|------|--------------|
| `listing_commitment_sync` | W5.C.5 / W9.A | publishing a listing never anchors a PDA, so an observe window would annotate but not commit |
| `operators_and_control_api` issuer label | W11.A | edges cannot admit operator-minted capabilities; honesty says `session_capability_issuer=control_api` |
| `bonded_gateway_program` honesty field | W8 | public config never mentions the devnet bond |

Measure before and after:

```
bash scripts/gcp-host-a-control-api-drift-probe.sh
```

The probe greps the running `/server` binary. `present` for all three is the
exit condition.

## Why it waits

W10.A capability observe runs to 2026-08-21. A binary swap mid-window is a
change to the thing being observed. Roll **after** the decision record, in
the same maintenance step as whatever the decision says.

## Preconditions

- [ ] W10.A decision record written (stay observe / enforce / revert)
- [ ] No open `gateway-bond` challenge (`w8-gateway-bond fetch <operator>` shows `challenge=missing`)
- [ ] Working tree committed and pushed
- [ ] Old image id recorded for rollback

## Procedure

```bash
# 0. On the laptop: note the image currently serving traffic.
gcloud compute ssh proxyhubb-testnet --project=gen-lang-client-0022105784 \
  --zone=us-central1-a --command="sudo docker inspect -f '{{.Image}}' proxyhubb-control-api-1"

# 1. Sync source to the VM tree at /opt/proxyhubb/services/control-api.
#    The VM tree has drifted before (W10.C had to add settlement/receipt.go by
#    hand); prefer a clean copy of services/control-api + migrations.

# 2. Build, keeping the previous image reachable.
sudo docker tag proxyhubb-control-api proxyhubb-control-api:pre-roll-$(date -u +%Y%m%d)
sudo docker compose \
  -f docker-compose.yml \
  -f docker-compose.testnet.yml \
  -f docker-compose.gcp-testnet.yml \
  -f docker-compose.w6-host-a-private.yml \
  -f docker-compose.w10-observe.yml \
  build control-api

# 3. Swap. All five overlays. Never --remove-orphans (J2 edges, redis-ha, and
#    the observe edges look like orphans to an API-only compose).
sudo docker compose <same five -f flags> up -d --no-deps control-api
```

## Verification (all must pass)

```bash
curl -fsS http://127.0.0.1:18080/health
sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_SESSION_CAPABILITY   # observe (or whatever 08-21 decided)
sudo docker exec proxyhubb-control-api-1 printenv GATEWAY_OP_A_HOST_ID          # gce-proxyhubb-testnet
sudo docker exec proxyhubb-control-api-1 printenv GATEWAY_OP_B_HOST_ID          # gce-w6-operator-b
bash /tmp/gcp-host-a-control-api-drift-probe.sh                                 # three MISSING become present
/tmp/w9d-bin/w7b-manifest-bundle verify /opt/proxyhubb/ops/operators-bundle.json
curl -fsS https://api.proxyhubb.com/v1/system/config/public
```

Expected honesty deltas, and nothing else:

- `session_capability_issuer` `control_api` → `operators_and_control_api`
  (a bundle pin is configured)
- a `bonded_gateway_program` field appears
- `listing_commitment_mode` stays `off`

`live_economic_slash` must stay **false**. `operator_org_diversity` must stay
`same_org`. If either moves, roll back.

## Rollback

```bash
sudo docker compose <five -f flags> down --no-deps control-api
sudo docker tag proxyhubb-control-api:pre-roll-<date> proxyhubb-control-api
sudo docker compose <five -f flags> up -d --no-deps control-api
```

Manifest seeds live in `/opt/proxyhubb/.env` and are unaffected by a rollback.
Rows are re-signed on every start with a 30-day expiry.

## Do not, in this step

- Flip `PROXYHUB_SESSION_CAPABILITY` (that is the 08-21 decision, recorded separately)
- Set `PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT`
- Set `PROXYHUB_LISTING_COMMITMENT=observe` (separate soak, after the roll)
- Arm `PROXYHUB_GATEWAY_SLASH_AUTO` / `PROXYHUB_GATEWAY_SLASH_CONFIRM`
- Deploy `programs/session`
- Pass `--remove-orphans`
