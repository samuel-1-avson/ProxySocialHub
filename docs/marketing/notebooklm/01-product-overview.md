# ProxyHubb — Product Overview

## One-sentence definition
ProxyHubb is a Solana-settled residential proxy marketplace. Buyers discover capacity, fund orders, and pull traffic through an edge gateway. Providers run a tunnel node that advertises capacity and earns from metered usage.

## Brand
- Public product name: ProxyHubb
- Website: https://proxyhubb.com
- Docs: https://docs.proxyhubb.com
- API: https://api.proxyhubb.com
- Positioning line: Quiet infrastructure for residential proxy bandwidth
- Tagline used on the product: The decentralized bandwidth marketplace

## What problem it solves
Residential proxy bandwidth is widely used for research, testing, automation, and other internet work that needs real household network routes. The usual buying experience is closed and opaque: hard-to-compare pricing, unclear quality, and billing that is difficult to audit. People with spare capacity also lack a clean marketplace path to publish and earn without becoming a full infrastructure company.

ProxyHubb turns that into a two-sided market with clearer rules.

## Who it is for
1. **Buyers** — people and teams who need residential proxy capacity
2. **Providers** — people who run nodes, publish listings, and earn from real usage
3. **Developers / partners** — teams that integrate via API and official SDKs
4. **Observers** — anyone who wants to inspect network activity on the public explorer

## Core value props
- Discover residential capacity in a marketplace instead of a closed vendor list
- Route traffic through a real edge gateway
- Meter usage at the edge so billing is tied to measured traffic
- Settle in a wallet-native way on Solana
- Let providers monetize capacity by running a node
- Keep the network inspectable through a public explorer

## Product surfaces
| Surface | What it is |
|---------|------------|
| Web app | Marketplace, dashboards, wallet, connect flows, explorer |
| Buyer proxy | HTTP CONNECT / SOCKS5 endpoint for live sessions |
| Control API | Auth, marketplace, orders, wallets, provider ops |
| Provider node / CLI | Daemon that tunnels capacity into the network |
| SDKs | Python, Node.js, and Go |
| Docs | Getting started, buyer flows, provider CLI, API reference |
| Explorer | Public view of nodes, sessions, and network activity |

## What makes it different from a typical proxy vendor
Typical vendors sell access to a closed pool with opaque invoices.

ProxyHubb is designed as a marketplace:
- buyers browse and purchase capacity
- providers publish supply
- usage is measured at the edge
- settlement is wallet-native
- network activity can be inspected publicly

## Honest maturity note
ProxyHubb is a live, early-stage product that is still shipping. Marketplace flows, buyer CONNECT, provider tunnels, docs, SDKs, and explorer surfaces exist. It should be described as an emerging bandwidth marketplace and builder project — not as a finished, finance-grade production monopoly or a fully trustless system.
