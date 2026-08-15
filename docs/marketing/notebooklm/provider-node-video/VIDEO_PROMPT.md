# NotebookLM Video Overview — Provider Node Custom Prompt

Paste this into NotebookLM **Video Overview → Customize**.

---

Create a cinematic, story-driven Video Overview about **how a provider puts residential proxy capacity onto ProxyHubb** — for a mixed audience: curious builders, potential providers, developers, and non-technical professionals.

## Goal
Help viewers understand:
1. what ProxyHubb is (briefly)
2. what a provider actually does
3. what a provider node is
4. how capacity moves from “home bandwidth” → node → listing → buyer access → measured usage

This is a provider-side explainer, not a crypto hype video and not a dry CLI dump.

## Tone
- Quiet confidence, not hype
- Clear infrastructure storytelling
- Human, specific, grounded in the uploaded sources only
- Clear enough for a non-technical viewer; credible enough for a technical one
- Curious and useful, not “get rich sharing bandwidth”

## Narrative arc (follow this order)
1. **Hook (0–15%)** — Most people only understand proxies from the buyer side. Open on the missing half: someone has to provide the route.
2. **What ProxyHubb is (15–25%)** — Define it plainly: a Solana-settled residential proxy marketplace. Buyers discover capacity; providers run nodes and publish supply; traffic routes through an edge gateway.
3. **The provider problem (25–35%)** — Spare residential capacity has historically lacked a clean marketplace path. People either become full operators or join opaque middlemen.
4. **Mental model (35–50%)** — Explain the architecture in plain English:
   - buyer does not connect straight to the provider laptop
   - buyer hits the edge gateway
   - provider node opens an **outbound tunnel** into the gateway
   - when selected, the node carries traffic to the public internet
   - usage is designed to be metered at the edge
5. **Provider journey (50–80%)** — Walk the steps clearly:
   - connect wallet / become a provider
   - download provider CLI / node config
   - start the node (tunnel, heartbeats, online status)
   - publish a marketplace listing
   - buyer purchases and routes through the edge
   - provider earns from real routed / measured usage
6. **Close (80–100%)** — End on quieter infrastructure with clearer rules. Providers are participants, not invisible supply. Mention the product is early / still shipping. Invite curiosity. Mention proxyhubb.com and docs.proxyhubb.com.

## Must include
- Plain-English explanation of residential bandwidth / residential proxies
- Provider node as the machine that joins capacity to the network
- Outbound tunnel idea (works from ordinary home networks)
- Marketplace listing / publish supply
- Edge gateway + metering as a trust signal
- Wallet-native Solana without crypto buzzwords
- That ProxyHubb is early and still shipping

## Must NOT include / invent
- Fake stats, user counts, revenue, or SLA guarantees
- “99.9% uptime” or “<50 ms” as proven facts
- Guaranteed passive income / get-rich claims
- Claims that the system is fully trustless, fully decentralized, or production-hardened finance-grade
- Agents marketplace as a live paid product
- ISP targeting promises
- Technical jargon dumps (Yamux, Halo2, QUIC, FSM, lease internals) unless one brief plain-English mention helps
- Hard CTAs like “invest now” or “start earning today guaranteed”

## Style notes for visuals/narration
- Prefer metaphors of markets, pipes, inventory, and quiet infrastructure
- Alternate between plain language and light technical credibility
- Keep sentences short enough to speak aloud
- Treat this like a short documentary explainer about supply-side infrastructure
- Spend more time on the provider path than on buyer onboarding
- When showing the buyer, keep it brief — only enough to close the loop

## Length preference
Aim for a complete provider story in one pass. Prioritize clarity over covering every dashboard feature.
