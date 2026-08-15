# Evidence: Wave 5.B multi-operator gateways — 2026-08-11 / soak PASS 2026-08-12

## Verdict

**PASS** — operator discovery OPS + peer-forward CONNECT soak on gcp-testnet.

Same-host multipod / shared control-plane SPOF remains. Not DePIN. Stake/slash hooks remain observe-only.

## Exit claim status

| Item | Status |
|------|--------|
| Operator discovery API | **PASS** — `W5B_OPERATORS_OK` |
| Tunnel addrs prefer registry | **CODE** — unit tested; wired in control-api |
| Bond-enforce flag + honeytoken→`slashing_events` | **CODE** — default off; edge posts `/v1/gateway/slash-audit` |
| Peer-forward CONNECT soak | **PASS** — `W5B_PEER_FORWARD_OK` (2026-08-12) |

## Discovery smoke (live)

```
count 2 healthy 2 bond_enforce False
honesty centralized discovery; same-host multipod logical operators — not DePIN
gateway_operator_bond_enforce False
W5B_OPERATORS_OK
```

- Endpoint: `GET http://127.0.0.1:18080/v1/gateways/operators`
- Seeded slugs: `edge-a`, `edge-b`
- Migration `000147_gateway_operators`

## Peer-forward soak (PASS)

Path: provider yamux/TLS on **edge-a** `:3128` → buyer CONNECT + tunneled HTTPS GET via **edge-b** `:18091`.

### Fixes required for soak

1. **TLS yamux AUTH** — provider must use `use_tls=true` + `tls_skip_verify` on loopback (J2 tunnel is TLS).
2. **Writable Redis master** — after HA failover, `redis-replica` was removed / inverted; edges must use live master (`redis://…@redis:6379` at soak time). Stale `redis-replica` URLs caused session `407` / directory write failures.
3. **Session `credential_password_hash`** — SHA-256 hex of proxy password required for legacy Basic auth.
4. **Signed heartbeats** — `PROXYHUB_REQUIRE_SIGNED_HEARTBEATS` enforce; soak sets `node_id` (Control API UUID) so provider emits proofs (empty `node_id` skipped proofs → unhealthy → peer `503`).

### Live proof (2026-08-12T02:57:08Z)

```
owned=1
CONNECT_RESP HTTP/1.1 200 OK
ORIGIN_OK  (HTTP/1.1 200 from example.com via Cloudflare)
edge_gateway_provider_route_selection_total{route="remote"} 1
DEBUG Accepting internal peer forward node_id=node_b77e84c9-… dest=example.com:443
W5B_PEER_FORWARD_OK
```

Artifacts on VM: `/tmp/w5b_peer_prove.log`, `/tmp/w5b-origin.txt`, `/tmp/w5b-metrics-b.txt`.

## Non-claims

- Not independent host/org DePIN
- Not trustless gateway selection
- Not multi-region mesh
- Not live economic slash / `programs/session`

## Artifacts

| Path | Role |
|------|------|
| `migrations/000147_gateway_operators.*.sql` | Schema |
| `services/control-api/internal/gateways/` | Registry + bond filter |
| `services/control-api/internal/api/gateway_operators.go` | Public GET + slash-audit |
| `scripts/gcp-smoke-sprint-w5b-operators.sh` | Discovery smoke |
| `scripts/gcp-smoke-w5b-peer-tls.sh` | Peer soak helper |
| ADR 0007 | Accepted (W5.B) |

## Follow-ups (post-PASS)

1. Keep J2 `REDIS_URL` on Sentinel-resolved **writable master** (avoid hard-coding failed-over replica hostname)
2. Provider-node: sign heartbeats even when `provider.toml` omits `node_id` (fallback to gateway runtime id) — code fix in tree
3. Wave 5.C — catalog & money autonomy
