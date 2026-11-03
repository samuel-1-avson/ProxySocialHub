# proxyhubb-mcp — ProxyHubb for AI agents

An [MCP](https://modelcontextprotocol.io) server that gives any agent **verified,
budget-capped residential proxy sessions** on the ProxyHubb marketplace: pick a
country, choose sticky or rotating, cap the spend — a person in that country
carries the traffic and keeps ~95% of the price, settled per session on Solana.

> **Status (2026-11-03):** v0.1.0. Tools wrap the existing public control API
> (`/v1/sessions/intent`, `/v1/listings…`, `/v1/usage…`, `/v1/orders…`).
> Verified end-to-end against the live testnet API for read tools; session
> creation needs your account JWT and follows the deployment's normal
> plan/escrow rules — if the API says funding is required, the tool reports it
> and never bypasses it. **On the testnet new sessions need escrow funding**, so
> use `list_my_orders` + `use_my_order` to run on an order you already bought in
> the web app (the same path the Regional Auditor uses). The order tools are
> covered by mocked-API tests; they have not yet been run against a live order.

## Tools

| Tool | What it does |
| --- | --- |
| `list_regions` | Countries / proxy types / ISPs / price buckets with active listing counts |
| `discover_listings` | Search provider listings; filter by country, type, text, max price/GB |
| `create_agent_session` | Mint a disposable session intent → `proxy_url`. Defaults: rotating per-request, **100 MB / 20 min caps**. `sticky` for browser work. Supports `max_price_per_gb`, `allowed_domains`, `blocked_domains`, `listing_id` |
| `list_my_orders` | Your **active**, already-paid marketplace orders with each listing's seller-declared country (no seller, wallet, price or credentials). Optional `country` filter |
| `use_my_order` | `proxy_url` for one active order. Refuses with a `code` (`order_not_active`, `order_not_ready`, `order_region_mismatch`, `order_expired`, `order_gateway_mismatch`, …) instead of guessing; never asks for an inactive order's credentials, because that can re-activate its session |
| `verify_exit` | Real request **through** the proxy; compares the observed egress IP's GeoIP estimate with the expected country → `verified · mismatch · unverified · direct_egress · unavailable` |
| `get_session_usage` | Metered usage by session, intent details, or account usage (credentials redacted) |
| `close_agent_session` | Terminate a live session; for intents, honestly reports expiry (no revocation endpoint exists) |

## Safety model (agents get an allowance, not your wallet)

- Sessions are minted with **your account JWT** (`PROXYHUBB_ACCESS_TOKEN`), so
  plan limits, metering and escrow apply exactly as in the web app. This server
  never signs transactions and never funds escrow.
- Hard caps on every session: `max_mb` (5–10 240, default 100) and
  `time_limit_minutes` (1–240, default 20) are enforced in the signed intent.
- **Orders are prepaid allowances.** `use_my_order` spends only bandwidth you
  already bought; this server cannot set a smaller cap on an order. The order
  tools work with an API key that has the `orders:create` scope instead of your
  JWT. That scope is narrower than your login, but it also lets the key create
  and cancel orders and start payments, which this server never does.
- **Verify before you trust:** country routing is best-effort at the gateway.
  `verify_exit` measures the real exit; treat content as a country's behaviour
  only when `assurance = verified`. A mismatch is reported, never silently used.
- Tool output redacts credentials/PII, except the `proxy_url` you asked for —
  treat that URL as a secret. Use sessions only for sites and tasks you are
  authorized to access (regional QA, price research, ad verification, your own
  properties).

## Quick start

Requires Node ≥ 24.

```bash
cd services/proxyhubb-mcp
npm install
npm test            # unit tests (mocked API)
npm run example     # live read-only smoke: lists real regions via MCP stdio
```

### MCP client config

Claude Desktop / Cursor / any stdio MCP client:

```json
{
  "mcpServers": {
    "proxyhubb": {
      "command": "node",
      "args": ["<repo>/services/proxyhubb-mcp/src/server.ts"],
      "env": {
        "PROXYHUBB_ACCESS_TOKEN": "<your dashboard JWT>",
        "PROXYHUBB_BASE_URL": "https://api.proxyhubb.com",
        "PROXYHUBB_PROXY_ENDPOINT": "proxy.proxyhubb.com:8090"
      }
    }
  }
}
```

### Environment

See [`.env.example`](./.env.example). `PROXYHUBB_API_KEY` (`phub_…`) is optional
and sent as `X-API-Key` when set. It cannot by itself create sessions, but with
the `orders:create` scope it is enough for `list_my_orders` and `use_my_order`.

## Example agent

[`examples/mcp-research-agent.ts`](./examples/mcp-research-agent.ts) connects like
a real MCP client and lists regions. With a token (or an `orders:create` API
key) it then gets a session for `EXAMPLE_COUNTRY` (default `GH`): an active
order you already paid for when there is one, otherwise (token only) a newly
minted capped sticky session. It verifies the exit, printing only a masked
proxy URL. From there, hand `proxy_url` to Playwright (`proxy: { server, username,
password }`), fetch, or your framework of choice, and use
[`../../docs/hackathon/REGIONAL_AUDITOR.md`](../../docs/hackathon/REGIONAL_AUDITOR.md)'s
Auditor as the reference Meta-model consumer of the same sessions.

## Roadmap (post-hackathon)

Published package (`npx proxyhubb-mcp`), gateway-enforced `strict_geo`, LangChain/
CrewAI snippets, and an x402-on-Solana spike so agents can pay per session in USDC
without a human-managed account. See
[`../../docs/hackathon/AGENTIC_PROXY_STRATEGY_2026-11-02.md`](../../docs/hackathon/AGENTIC_PROXY_STRATEGY_2026-11-02.md) §9.
