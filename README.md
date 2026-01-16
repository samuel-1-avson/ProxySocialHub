# Ghana-first Proxy Marketplace (v1)

A verified, consent-based marketplace for Ghana HTTP/HTTPS proxy egress.

## Structure

- **Frontend**: Next.js 15, TailwindCSS, Lucide Icons
- **Backend**: Go (Gin), PostgreSQL, Redis
- **Auth**: JWT, Google/GitHub OAuth
- **Status**: OAuth Integration Live (Hybrid Vercel/Local), Session, Billing
- **`/services/edge-gateway`**: Data Plane (Rust) - Proxy, Tunnel Termination
- **`/apps/web`**: Buyer Dashboard & Admin Console (Next.js)
- **`/apps/provider-desktop`**: Provider App (Tauri)
- **`/infra`**: Deployment configuration (Docker Compose)
