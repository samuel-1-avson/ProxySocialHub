# Wave 6.A — second-host edge fleet (ops)

Companion to [WAVE6](WAVE6_DECENTRALIZATION_PLAN.md) / [ADR 0012](../adr/0012-independent-gateway-operators.md).

## Goal

Run **edge-b** on a distinct machine from `proxyhubb-testnet`. Shared control-api /
Postgres / Redis is allowed. Not DePIN.

## Live inventory (2026-08-12 W6.A)

| Host | VM | Zone | Public IP | Internal IP |
|------|-----|------|-----------|-------------|
| A | `proxyhubb-testnet` | us-central1-a | 35.255.62.196 | 10.128.0.36 |
| B | `proxyhubb-w6-edge-b` | us-west1-b | 35.252.224.81 | 10.138.0.2 |

Host-A `.env` / compose:

```
HOST_A_INTERNAL_IP=10.128.0.36
GATEWAY_OP_A_HOST_ID=gce-proxyhubb-testnet
GATEWAY_OP_B_HOST_ID=gce-w6-operator-b
GATEWAY_OP_B_TUNNEL=35.252.224.81:3128
GATEWAY_OP_B_BUYER_URL=http://35.252.224.81:8090
GATEWAY_OP_B_HEALTH_URL=http://35.252.224.81:8090/health
GATEWAY_OP_A_PEER_URLS=edge-b@http://10.138.0.2:8090
```

Firewall: `allow-proxyhubb-w6-edge-b` (8090/3128/22), `allow-proxyhubb-w6-private-cp` (8080/6379 from B tag → A tag).

## Host-A (existing gcp-testnet)

Keep J2 `edge-gateway-a`. Set distinct host ids before seeding:

```
GATEWAY_OP_A_HOST_ID=gce-proxyhubb-testnet
GATEWAY_OP_B_HOST_ID=gce-w6-operator-b
GATEWAY_OP_B_TUNNEL=<host-b-public-ip>:3128
GATEWAY_OP_B_BUYER_URL=http://<host-b-public-ip>:8090
GATEWAY_OP_B_HEALTH_URL=http://<host-b-public-ip>:8090/health
GATEWAY_OP_A_PEER_URLS=edge-b@http://<host-b-private-or-public>:8090
```

`GET /v1/gateways/operators` honesty must show `operator_host_diversity=two_hosts`.
Loopback twins (`primary-loopback`, `127.0.0.1`) stay `same_host`.

## Host-B

1. Copy `docker-compose.w6-remote-edge.yml`, certs, `.env` secrets that **match** host-A
   (`JWT_SECRET`, `GATEWAY_SHARED_SECRET`, `SESSION_SECRET`).
2. Reach Redis and control-api on a **private** path (VPC, SSH tunnel, stunnel).
   Do not bind Redis to `0.0.0.0`.
3. `docker compose -f docker-compose.w6-remote-edge.yml up -d`
4. Confirm `curl http://127.0.0.1:8090/health` and that host-A can GET that health URL.

## Remaining SPOFs (document for W6.C)

- Shared control-api (session mint / discovery)
- Shared Postgres
- Shared Redis master (session blobs + directory)
- DNS / public IP of either host
- Killing host-A still takes down minting even if host-B edge stays up

## Non-claims

- Not a second control plane
- Not multi-region mesh
- Not live economic slash
