# NotebookLM Video Overview — Custom Prompt

Paste this into NotebookLM **Video Overview → Customize**.

---

Create a cinematic, story-driven Video Overview about ProxyHubb for a mixed audience: founders, developers, and non-technical professionals who care about internet infrastructure.

## Goal
Help viewers understand what ProxyHubb is, why it exists, and what makes it different — without sounding like a crypto hype video or a dry product demo.

## Tone
- Quiet confidence, not hype
- Adventure / builder journey, not pitch-deck
- Clear enough for a non-technical viewer; credible enough for a technical one
- Human, specific, grounded in the uploaded sources only

## Narrative arc (follow this order)
1. **Hook (0–20%)** — Open on the invisible problem: residential bandwidth is critical internet plumbing, but buying and selling it usually feels opaque.
2. **Why it was built (20–35%)** — Explain the founder motivation: frustration with closed vendors, unclear pricing, unauditable usage, and no clean way for providers to monetize spare capacity.
3. **What ProxyHubb is (35–50%)** — Define it plainly: a Solana-settled residential proxy marketplace. Buyers discover capacity and route traffic; providers run nodes and earn from real usage.
4. **The build adventure (50–75%)** — Tell the story of building the full stack: marketplace, control plane, edge gateway that meters usage, provider nodes that work behind home networks, SDKs/CLI/docs, and a public explorer.
5. **How it works today (75–90%)** — Walk through both sides simply:
   - Buyer: connect Solana wallet → browse/buy capacity → traffic routes through the edge → usage is measured
   - Provider: run a node → publish listings → earn when buyers route through your capacity
6. **Close (90–100%)** — End on the north star: quiet infrastructure with clearer rules. Invite curiosity, not hard sell. Mention proxyhubb.com.

## Must include
- Plain-English explanation of residential proxies / residential bandwidth for non-technical viewers
- Two-sided marketplace (buyers + providers)
- Edge metering as a trust signal (usage measured at the gateway, not just self-reported)
- Wallet-native Solana settlement (without crypto buzzwords)
- Public explorer as transparency
- That the product is early / still shipping

## Must NOT include / invent
- Fake stats, user counts, revenue, or SLA guarantees
- “99.9% uptime” or “<50 ms” as proven facts
- Claims that the system is fully trustless, fully decentralized, or production-hardened finance-grade
- Agents marketplace as a live paid product
- ISP targeting promises
- Technical jargon dumps (Yamux, Halo2, QUIC, FSM) unless briefly useful and explained
- Hard CTAs like “invest now” or “get rich sharing bandwidth”

## Style notes for visuals/narration
- Prefer metaphors of markets, pipes, and quiet infrastructure over “disruption”
- Alternate between plain language and light technical credibility
- Keep sentences short enough to speak aloud
- Treat this like a short founder documentary, not an ad

## Length preference
Aim for a complete story in one pass. Prioritize clarity over covering every feature.
