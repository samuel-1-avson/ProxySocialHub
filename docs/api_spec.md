# API Contracts (REST & gRPC)

## Authentication
POST /auth/login
POST /auth/refresh

## Buyer APIs
GET /proxies
POST /sessions/start
POST /sessions/stop
GET /billing/usage

## Provider APIs
POST /provider/register
POST /provider/heartbeat
GET /provider/earnings

## Clan APIs
POST /clans
POST /clans/join
GET /clans/{id}/stats

## Billing APIs
POST /billing/settle
GET /billing/history

## Metering (Redis)
> **Note:** Metering is handled via direct Redis Atomic Counters (`INCR`) for maximum performance (sub-millisecond latency) rather than gRPC.
- **Key:** `session:{username}:usage`
- **Value:** `int64` (bytes)

## gRPC (Edge Gateway)
service RoutingService {
  rpc RequestRoute(SessionRequest) returns (RouteInfo);
}

