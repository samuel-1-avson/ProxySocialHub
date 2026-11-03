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
> the web app (the same path the Regional Auditor uses). The order tools ran
> against a live order on 2026-11-03 (order → credentials → traffic through the
> exit). `fetch_url` is new: its tunnel code was checked against real HTTPS
> sites through a local proxy, not yet through a live order.

## Tools

| Tool | What it does |
| --- | --- |
| `fetch_url` | **Start here in a chat agent.** Fetches one public `https://` page through your active order for a `country`, verifies the exit first, and returns the title and readable text. No credential is returned. Refuses an unverified exit unless `require_verified=false` (then the result is labelled). HTTPS on 443/8443 only, no private or internal hosts, 2 MB and 5 redirects at most |
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
  treat that URL as a secret. `fetch_url` keeps the credential inside the server
  and never returns one. Use sessions only for sites and tasks you are
  authorized to access (regional QA, price research, ad verification, your own
  properties).
- **Page text is data, not instructions.** `fetch_url` returns what a website
  says; an agent must not follow instructions found in it.

## Quick start

Requires Node ≥ 24.

```bash
cd services/proxyhubb-mcp
npm install
npm test            # unit tests (mocked API)
npm run example     # live read-only smoke: lists real regions via MCP stdio
```

## Connect your agent

You need: Node 24 or later, this repository with `npm install` run in
`services/proxyhubb-mcp`, an active order for the country you want (buy one at
<https://proxyhubb.com/marketplace>), and your access token (see "Getting your
access token" below). Use the **absolute** path to `src/server.ts`; on Windows,
write it with forward slashes (`C:/Users/you/.../src/server.ts`). The examples
below use `<path>` for it.

The token ends up in your client's config file. Keep that file private, never
commit it, and replace the token when it expires (it lasts up to 24 hours; a
longer-lived agent key is planned, see
[`docs/plans/MCP_AGENT_INTEGRATION_PLAN_2026-11-03.md`](../../docs/plans/MCP_AGENT_INTEGRATION_PLAN_2026-11-03.md)).

Then ask your agent, for example: *"Use ProxyHubb to fetch https://example.com
as seen from Ghana and tell me what the page says."*

### Claude Desktop

Settings → Developer → **Edit Config** opens `claude_desktop_config.json`
(Windows: `%APPDATA%\Claude\`, macOS: `~/Library/Application Support/Claude/`).
Add the server, save, and restart Claude Desktop:

```json
{
  "mcpServers": {
    "proxyhubb": {
      "command": "node",
      "args": ["<path>"],
      "env": { "PROXYHUBB_ACCESS_TOKEN": "<your token>" }
    }
  }
}
```

### Claude Code

```bash
read -rs PROXYHUBB_ACCESS_TOKEN   # paste the token and press Enter; nothing is shown
claude mcp add proxyhubb -s user -e PROXYHUBB_ACCESS_TOKEN="$PROXYHUBB_ACCESS_TOKEN" -- node <path>
```

In Windows PowerShell, run `claude.cmd` instead of `claude` (the execution
policy blocks the `claude.ps1` shim), and pass the token from a variable so it
stays out of your command history:

```powershell
$env:PROXYHUBB_ACCESS_TOKEN = Read-Host "Token"
```

```powershell
claude.cmd mcp add proxyhubb -s user -e "PROXYHUBB_ACCESS_TOKEN=$env:PROXYHUBB_ACCESS_TOKEN" -- node <path>
```

`claude mcp list` then shows whether it connects.

### Cursor

Add to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` in a project
you never commit:

```json
{
  "mcpServers": {
    "proxyhubb": {
      "command": "node",
      "args": ["<path>"],
      "env": { "PROXYHUBB_ACCESS_TOKEN": "<your token>" }
    }
  }
}
```

### VS Code (agent mode)

Add `.vscode/mcp.json`. VS Code asks for the token when the server starts and
stores it as a secret, so it is not written into the file:

```json
{
  "inputs": [
    { "type": "promptString", "id": "proxyhubb-token", "description": "ProxyHubb access token", "password": true }
  ],
  "servers": {
    "proxyhubb": {
      "type": "stdio",
      "command": "node",
      "args": ["<path>"],
      "env": { "PROXYHUBB_ACCESS_TOKEN": "${input:proxyhubb-token}" }
    }
  }
}
```

### Other settings

The defaults point at the live testnet. To override, add
`"PROXYHUBB_BASE_URL"` (control API, default `https://api.proxyhubb.com`) or
`"PROXYHUBB_PROXY_ENDPOINT"` (gateway, default `proxy.proxyhubb.com:8090`) to
`env`.

### If something goes wrong

| You see | Meaning |
| --- | --- |
| `403: provider token cannot call this route` | The token came from the ProxyHub provider app; use your website session token |
| `401` | The token expired; copy a fresh one |
| `no_active_order` | Buy an order for that country first |
| `not_fetched` with `direct_egress` | The node carrying your order is on your own internet connection; run the node and the agent on different connections (or pass `require_verified=false` to fetch anyway, labelled unverified) |
| `unverified` and a satellite network | The exit is on Starlink or similar; its country can't be confirmed |

### Environment

See [`.env.example`](./.env.example). `PROXYHUBB_API_KEY` (`phub_…`) is optional
and sent as `X-API-Key` when set. It cannot by itself create sessions, but with
the `orders:create` scope it is enough for `list_my_orders` and `use_my_order`.

### Getting your access token

The website keeps your session token in the page's memory only (it is not in
local storage or a readable cookie), so copy it from a request:

1. In your normal browser (not the ProxyHub provider app), sign in at
   <https://proxyhubb.com/marketplace/orders>. If your order is listed there as
   active, this token can use it.
2. Open DevTools (F12) → **Network**, type `v1/orders` in the filter, and reload.
3. Click the `orders` row of type `fetch`. The website calls the API through its
   own address, so the request goes to `proxyhubb.com/v1/orders`, not to
   `api.proxyhubb.com`.
4. Under **Headers → Request Headers**, copy the part of `authorization` after
   `Bearer ` (it starts with `eyJ`). Leave out the word `Bearer`.

The token is your full login and lasts up to 24 hours (the control API's default
`ACCESS_TOKEN_TTL_MINUTES`).

Do **not** use a token from the ProxyHub provider app or CLI: that is a
*provider node token*, limited to node routes, and every tool here answers
`403: provider token cannot call this route` with it. In PowerShell, set the
token with `$env:PROXYHUBB_ACCESS_TOKEN = Read-Host "Token"` so it does not land
in your command history, and never paste it into a chat or a shared log.

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
