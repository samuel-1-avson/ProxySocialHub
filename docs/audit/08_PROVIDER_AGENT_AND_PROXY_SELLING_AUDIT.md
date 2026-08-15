# 08 — Provider Agent & Proxy-Selling Audit

**Components:** `services/provider-node` (Rust agent), `cli` (Rust onboarding wrapper), config `provider.toml`.

## 1. Can a user genuinely sell bandwidth? — **YES**

The agent implements the full selling path:

1. **Enroll:** CLI `join` → control-api enrollment → API key/token (`cli/src/main.rs:259-302` delegates; provider config written to `provider.toml`).
2. **Authenticate:** `POST /v1/provider/auth` (validateProviderToken) → scoped JWT; `POST /v1/provider/gateway-token` → edge JWT.
3. **Connect:** agent dials **outbound** TCP+TLS (or QUIC) to the gateway tunnel port → yamux reverse session with AUTH + CAPABILITY frames + optional lease (`provider-node tunnel.rs:347-385`).
4. **Serve:** gateway opens yamux streams carrying `CONNECT host:port\n`; agent resolves DNS, rejects non-public targets, dials, bridges (`handler.rs:89-170, 227-247`).
5. **Report:** heartbeats (tunnel + control-api) keep node online; local STATS for ops; earnings read from control-api.

**NAT / CGNAT / mobile / dynamic IP:** fully supported — no inbound listener required; reconnect logic handles interface changes. Intermittent connections mark node offline via heartbeat monitor (`worker.StartHeartbeatMonitor`).

## 2. Security of the provider's own network

| Threat | Control | Verdict |
|--------|---------|---------|
| Buyer → provider LAN/private IPs | Post-DNS public-IP-only egress: rejects 10/8, 172.16/12, 192.168/16, 169.254.0.0/16 (incl. 169.254.169.254), CGNAT 100.64/10, loopback (`handler.rs:227-247,360-377` + tests) | ✅ strong |
| Router admin pages / local services | same filter + blocked_hosts config | ✅ |
| Files on provider device | agent exposes no filesystem interface | ✅ |
| DNS rebinding | resolved IP checked on every CONNECT | ✅ (this is the *only* rebinding defense — GW-07) |
| Malicious gateway commands | agent accepts only CONNECT frames on its tunnel; no shell/config push | ✅ |
| Provider inflating billed bytes | billing source of truth = **gateway-measured** bytes, not provider stats | ✅ good design |

## 3. Gaps

| ID | Gap | Severity | Detail |
|----|-----|----------|--------|
| PN-03 | No consent scheduling / availability windows in agent | Medium | Always-on once tunnel is up; caps exist (`bandwidth_limit_mbps`, `max_connections`, port/host blocks); scheduling must be platform-side or added to agent |
| PN-04 | Lease enforcement optional (`provider_leases_required` off = compat mode) | Medium | Unleased tunnels accepted; enable in production |
| PN-05 | Config changes need restart (file/env), no hot push | Low | gateway has Redis `node:config` fanout; agent does not |
| PN-06 | Auto-update mechanism absent | Low | CLI downloads exist (`/v1/cli/downloads*`) but no self-update channel |
| CLI-01 | CLI is a wrapper, no own data-plane | Info | `join/start/doctor` delegate to provider-node |
| — | Availability/latency/reputation are self-reported (heartbeats, local stats) | Medium | platform lacks independent probing → trust signals can be gamed (T4) |

## 4. Provider lifecycle states

```
installed → enrolled (token) → tunnel up (online) → leased (optional) → serving
→ [heartbeat miss > 5m] → offline (heartbeat monitor)
→ revocation: token rotate/delete (/v1/provider/tokens/:id/rotate) → gateway JWT exchange fails → tunnel rejected
```

## 5. OS compatibility & packaging

- CI release workflow builds Windows/macOS/Linux binaries (`cli-dist-release.yml`); artifacts land in GitHub Releases; web dashboard offers downloads (`/v1/cli/downloads*`).
- Docker path exists (`config/docker/provider.toml`, compose `provider` file) for always-on providers.

## 6. Verdict

Proxy-selling is **real and functional**, including the hard part (NAT traversal via reverse tunnels) and the critical safety part (egress filtering). Before scaling: enforce leases (PN-04), add availability scheduling/consent (PN-03), and add platform-side verification so marketplace stats are not provider-claimed.
