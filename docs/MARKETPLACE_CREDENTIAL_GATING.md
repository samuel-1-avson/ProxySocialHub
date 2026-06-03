# Marketplace credential gating

**Policy:** Proxy credentials for marketplace purchases are not usable on the edge gateway until the buyer’s Solana escrow is confirmed on-chain.

## Lifecycle

1. `POST /v1/orders` creates an order (`pending`) and a linked session in **`disabled`** status. Credentials are stored in Postgres but **not** written to Redis and **not** returned in the API response.
2. `POST /v1/orders/:id/pay/solana` moves the order to `pending_payment` and returns escrow parameters.
3. After the buyer signs the escrow transaction, `escrow_listener` sets the order to **`active`** and calls `marketplace.ActivateOrderSession`, which:
   - Sets the session to **`active`**
   - Syncs Redis for edge-gateway authentication
4. `GET /v1/orders/:id/credentials` returns credentials only when the buyer owns the order and status is `active` or `completed`.

## Client behavior

`BuyListingModal` completes the on-chain escrow step, polls until the order is `active`, then fetches credentials from `/v1/orders/:id/credentials`.

Playwright mock-buy (`__PROXYHUB_E2E_MOCK_BUY__`) may still use stubbed credentials from mocked `POST /v1/orders` responses without hitting the real backend policy.
