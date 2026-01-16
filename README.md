# Ghana-first Proxy Marketplace (v1)

A verified, consent-based marketplace for Ghana HTTP/HTTPS proxy egress.

## Structure

- **`/proto`**: gRPC protobuf definitions
- **`/services/control-api`**: Control Plane (Go) - Auth, Session, Billing
- **`/services/edge-gateway`**: Data Plane (Rust) - Proxy, Tunnel Termination
- **`/apps/web`**: Buyer Dashboard & Admin Console (Next.js)
- **`/apps/provider-desktop`**: Provider App (Tauri)
- **`/infra`**: Deployment configuration (Docker Compose)
