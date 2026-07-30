# B2B sandbox purchase (API keys)

Partner machine clients buy marketplace listings with `phub_` API keys scoped to
`orders:create` (Phase 3C-2 / #31).

## Mint a purchase key (JWT session)

```http
POST /v1/bulk/api-keys
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "partner-sandbox",
  "scopes": "orders:create"
}
```

Response includes the plaintext key **once**. Keys with `orders:create` default to
**20 requests/minute**. Key create/revoke requires a user session — API keys cannot
mint other keys.

Revoke:

```http
DELETE /v1/bulk/api-keys/{key_id}
Authorization: Bearer <access_token>
```

## Authenticate

```http
X-API-Key: phub_<hex>
```

or `Authorization: Bearer phub_<hex>`.

## Live purchase (real escrow)

1. `POST /v1/orders` — body `{ "listing_id", "bandwidth_gb" }`  
   Requires wallet SOL preflight for the buyer user tied to the key.
2. `POST /v1/orders/{id}/pay/solana` — fund on-chain escrow (JWT typically; browser wallet).
3. After confirmation → `GET /v1/orders/{id}/credentials`

## Sandbox mocked buy (no chain)

Requires `PROXYHUB_ALLOW_DEV_ESCROW_ACTIVATE=true` on control-api
(not enabled for production/staging unless explicitly set).

### One-shot

```http
POST /v1/orders/sandbox-buy
X-API-Key: phub_<hex>
Content-Type: application/json

{
  "listing_id": "<uuid>",
  "bandwidth_gb": 1
}
```

Skips wallet SOL preflight, creates the order, simulates escrow activation, and
returns `proxy_credentials` in the same response (`sandbox: true`).

### Multi-step (same gate)

```http
POST /v1/orders
X-API-Key: phub_<hex>
…

POST /v1/orders/{id}/activate-dev
X-API-Key: phub_<hex>

GET /v1/orders/{id}/credentials
X-API-Key: phub_<hex>
```

## Audit

Successful key create/revoke and order create / sandbox activation write audit
events: `api_key.created`, `api_key.revoked`, `order.created`, `order.dev_activated`.

## Scope enforcement

| Scope | Allows |
|-------|--------|
| `orders:create` | create order, sandbox-buy, activate-dev, credentials |
| `proxy:read` / `proxy:write` | bulk pools only — **not** marketplace purchase |
