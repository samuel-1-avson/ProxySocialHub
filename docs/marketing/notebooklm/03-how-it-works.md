# How ProxyHubb Works

## Simple mental model
Think of ProxyHubb as a marketplace for residential internet capacity.

- Buyers need routes through real residential networks
- Providers have capacity they can share by running a node
- The platform matches them, routes traffic through an edge gateway, measures usage, and settles against wallet balances

## For non-technical viewers
Imagine unused bandwidth as inventory, and ProxyHubb as the market where that inventory can be listed, bought, and measured.

You do not need to understand the networking stack to understand the idea:
1. Connect with a wallet
2. Buy capacity or offer capacity
3. Traffic flows
4. Usage is counted
5. Settlement happens against your wallet

## For technical viewers
ProxyHubb separates control plane and data plane:

- **Web + Control API** — auth, marketplace, orders, wallets, provider operations
- **Edge gateway** — admits buyer sessions (HTTP CONNECT / SOCKS5) and meters bytes
- **Provider node** — outbound tunnel client that advertises capacity and carries traffic
- **Solana wallet auth / settlement design** — wallet-native access and settlement rail
- **Explorer** — public inspection of network activity

## Buyer journey
1. Connect a Solana wallet (no password / email gate as the primary path)
2. Browse marketplace listings or use connect flows
3. Create and fund an order
4. Receive session credentials
5. Route traffic through the buyer proxy endpoint
6. Usage is measured at the edge

There is also a quicker path for some flows: create a session intent and connect with a session token.

## Provider journey
1. Become a provider / complete setup
2. Download the provider CLI / node
3. Start the node so it tunnels into the network (works from behind many home networks because the tunnel is outbound)
4. Publish listings
5. Earn when buyers route traffic through your capacity
6. Monitor earnings and withdraw according to platform wallet flows

## How trust is designed into the product
- **Marketplace discovery** — capacity is listed and comparable, not hidden in a private chat
- **Edge metering** — usage is measured where traffic actually flows
- **Wallet-native settlement** — payment and access are tied to Solana wallet flows rather than opaque portal billing alone
- **Public explorer** — nodes, sessions, and network activity can be inspected without an account

## Three-step product story (from the landing page)
1. Connect a wallet — Sign in with Solana
2. Buy or sell capacity — Browse listings or register nodes and publish supply
3. Route and settle — Traffic hits the edge gateway; usage settles against your wallet balance

## What buyers get
- Residential routes
- Transparent pricing intent
- Session credentials
- Usage they can reason about

## What providers get
- A path to publish capacity
- A node/CLI to join the network
- Earnings tied to real routed usage

## What developers get
- REST control API
- Official SDKs for Python, Node.js, and Go
- Docs for buyer proxy, marketplace, and provider CLI
