# How a Buyer Reaches Provider Capacity

Use this document so the video can show the full loop without becoming a buyer tutorial.

## Why this matters in a provider video
Viewers understand providing better when they see the moment capacity gets used.

The provider publishes supply.
The buyer purchases access.
Traffic routes through the edge and into a healthy provider tunnel.

## Buyer path (keep short in narration)
1. Connect a Solana wallet
2. Browse marketplace listings
3. Create and fund an order
4. Receive session credentials
5. Route traffic through the buyer proxy endpoint
6. Usage is measured at the edge

There is also a quicker session-intent path in some flows. Prefer the marketplace order story unless brevity needs the shorter version.

## Matching moment
When a buyer session is admitted:
- the edge gateway handles the buyer connection
- the system selects eligible provider capacity
- a healthy provider node carries the outbound request
- bytes flow across the tunnel
- metering is designed to happen at the gateway

That is the handshake between the two sides of the market.

## Trust signals to mention lightly
- Marketplace discovery — capacity is listed and comparable
- Edge metering — usage measured where traffic flows
- Wallet-native settlement — access and payment tied to Solana wallet flows
- Public explorer — nodes and sessions can be inspected without an account

## Three-step product story (landing page language)
1. Connect a wallet — Sign in with Solana
2. Buy or sell capacity — Browse listings or register nodes and publish supply
3. Route and settle — Traffic hits the edge gateway; usage settles against your wallet balance

## What not to invent
Do not invent SLA numbers, latency guarantees, user counts, or “always selected” routing promises.
Do not claim the system is fully trustless or fully decentralized end-to-end.
Keep the story concrete: listing → purchase → edge → provider tunnel → measured usage.
