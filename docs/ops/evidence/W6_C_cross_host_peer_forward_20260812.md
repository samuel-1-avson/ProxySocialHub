# Evidence: Wave 6.C cross-host peer-forward — 2026-08-12

## Verdict

**SCRIPT READY** — live `W6C_PEER_FORWARD_OK` **pending** W6.A host-B.

Same-VM J2 soak remains W5.B (`W5B_PEER_FORWARD_OK`) and is **not** this claim.

## Exit claim

Provider on host-A, buyer CONNECT on host-B, `route=remote` + origin 200.
Control-plane SPOF acknowledged.

## What landed

- `scripts/gcp-smoke-sprint-w6c-cross-host-peer.sh` fail-closes unless
  `operator_host_diversity=two_hosts`
- Remaining SPOFs printed every run: control-api, Postgres, Redis master, DNS

## Live remaining

After host-B is up: provider tunnel to host-A `:3128`, CONNECT via host-B `:8090`,
then `W6C_ORIGIN_GET=1` (or host-B `/metrics` remote counter).

## Non-claims

- Buyers still mint sessions via shared control-api
- Not DePIN
