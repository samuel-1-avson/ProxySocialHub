# Evidence: Wave 6.A second-host edge fleet — 2026-08-12

## Verdict

**PASS** — `W6A_HOST_DIVERSITY_OK` live.

## Exit claim

A second machine runs edge-b as a distinct operator. Shared control-api allowed.
Not DePIN.

## Live inventory

| Host | VM | Zone | Public | Internal | Role |
|------|-----|------|--------|----------|------|
| A | `proxyhubb-testnet` | us-central1-a | 35.255.62.196 | 10.128.0.36 | control-plane + edge-a |
| B | `proxyhubb-w6-edge-b` | us-west1-b | 35.252.224.81 | 10.138.0.2 | edge-b only (`e2-small`) |

## Proof

```
GET /v1/gateways/operators
honesty.operator_host_diversity = two_hosts
honesty.control_plane = shared
op edge-a host_id=gce-proxyhubb-testnet tunnel=proxy.proxyhubb.com:3128
op edge-b host_id=gce-w6-operator-b tunnel=35.252.224.81:3128

curl http://35.252.224.81:8090/health
{"status":"healthy","edge_pod_id":"edge-b-west"}

# host-A → host-B internal health + public tunnel
10.138.0.2:8090 healthy
35.252.224.81:3128 tcp succeeded
# host-B → host-A private CP
10.128.0.36:8080 succeeded
10.128.0.36:6379 succeeded
```

`W6A_HOST_DIVERSITY_OK`

## Wiring

- Firewall: `allow-proxyhubb-w6-edge-b` (22/8090/3128), `allow-proxyhubb-w6-private-cp` (8080/6379, B tag → A tag)
- Host-A overlay: `docker-compose.w6-host-a-private.yml` binds Redis + control-api to `10.128.0.36` only (not `0.0.0.0`)
- Host-B: `docker-compose.w6-remote-edge.yml`, image loaded from host-A `proxyhubb-edge-gateway-a:latest`

## Non-claims

- Not DePIN / not split control-plane
- Manifests unsigned (`observe`; `manifest_verified=false`) until operator signing keys are set
- Cross-host CONNECT soak is W6.C (needs a provider tunneled to A)
