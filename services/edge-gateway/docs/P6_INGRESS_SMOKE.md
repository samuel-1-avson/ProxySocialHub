# P6 ingress conformance smoke

One authenticated CONNECT per ingress surface. Run: `scripts/p6-ingress-smoke.ps1`.

**Prereqs:** dev stack with a healthy provider tunnel. For QUIC providers use both compose files:

```powershell
$env:ENABLE_SOCKS5 = '1'   # optional, for SOCKS5 surface
docker compose -f docker-compose.yml -f docker-compose.provider.yml --profile provider up -d
.\scripts\p6-ingress-smoke.ps1 -GatewayPort $env:EDGE_GATEWAY_PORT  # e.g. 18090
```

HTTP/3 buyer ingress remains SKIP until gateway is built with `ENABLE_HTTP3_INGRESS=1` and `:8443` is published.

## Run 2026-06-03 06:51:39 +00:00

| Surface | Status | Detail |
|---------|--------|--------|
| HTTP/1.1 CONNECT (:18090) | PASS | HTTP/1.1 200 OK |
| SOCKS5 CONNECT (:1080) | SKIP | port closed - set ENABLE_SOCKS5=1 and publish :1080 |
| HTTP/3 CONNECT (:8443) | SKIP | port closed - rebuild with ENABLE_QUIC=1, ENABLE_HTTP3_INGRESS=1, publish UDP/TCP :8443 |

Summary: pass=1 fail=0


## Run 2026-06-03 06:56:44 +00:00

| Surface | Status | Detail |
|---------|--------|--------|
| HTTP/1.1 CONNECT (:18090) | FAIL | HTTP/1.1 503 Service Unavailable / content-length: 30 / date: Wed, 03 Jun 2026 06:56:41 GMT |
| SOCKS5 CONNECT (:1080) | FAIL | SOCKS5 CONNECT failed REP=0x04 |
| HTTP/3 CONNECT (:8443) | SKIP | port closed - rebuild with ENABLE_QUIC=1, ENABLE_HTTP3_INGRESS=1, publish UDP/TCP :8443 |

Summary: pass=0 fail=2


## Run 2026-06-03 06:57:37 +00:00

| Surface | Status | Detail |
|---------|--------|--------|
| HTTP/1.1 CONNECT (:18090) | FAIL | HTTP/1.1 503 Service Unavailable / content-length: 30 / date: Wed, 03 Jun 2026 06:57:35 GMT |
| SOCKS5 CONNECT (:1080) | FAIL | SOCKS5 CONNECT failed REP=0x04 |
| HTTP/3 CONNECT (:8443) | SKIP | port closed - rebuild with ENABLE_QUIC=1, ENABLE_HTTP3_INGRESS=1, publish UDP/TCP :8443 |

Summary: pass=0 fail=2


## Run 2026-06-03 07:02:10 +00:00

| Surface | Status | Detail |
|---------|--------|--------|
| HTTP/1.1 CONNECT (:18090) | PASS | HTTP/1.1 200 OK |
| SOCKS5 CONNECT (:1080) | PASS | SOCKS5 REP=0x00 |
| HTTP/3 CONNECT (:8443) | SKIP | port closed - rebuild with ENABLE_QUIC=1, ENABLE_HTTP3_INGRESS=1, publish UDP/TCP :8443 |

Summary: pass=2 fail=0

