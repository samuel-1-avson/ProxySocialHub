# NotebookLM — Provider Node Video

Use this pack to generate a **Video Overview** about how a provider puts residential capacity onto ProxyHubb: setup → node → listing → buyer access → metered usage.

## Upload these sources (in this order)

1. `01-product-overview.md` — what ProxyHubb is
2. `02-provider-problem.md` — why providers need a cleaner path
3. `03-provider-node-journey.md` — the full provider story (main narrative)
4. `04-buyer-meets-provider.md` — how a buyer actually reaches provider capacity
5. `05-safe-claims.md` — guardrails so the video doesn’t overclaim

## Create the video in NotebookLM

1. Open [NotebookLM](https://notebooklm.google.com)
2. Create notebook: `ProxyHubb — Provider Node`
3. Upload the 5 markdown files above
4. Open **Video Overview**
5. Choose **Customize**
6. Paste the full contents of `VIDEO_PROMPT.md`
7. Generate

## Suggested visual style

If NotebookLM offers style options, prefer:
- Documentary / explainer
- Clean diagrams over meme energy
- Infrastructure / marketplace aesthetic — not crypto-casino

## After generation — QA checklist

- [ ] Says **ProxyHubb** correctly
- [ ] Explains residential bandwidth in plain English
- [ ] Centers the **provider** path (not only buyers)
- [ ] Explains the provider node as an **outbound tunnel** into the edge
- [ ] Mentions marketplace listing / publish capacity
- [ ] Mentions edge metering / measured usage
- [ ] Mentions wallet-native Solana without hype
- [ ] Does not invent stats, SLAs, or “passive income” promises
- [ ] Ends with curiosity / explore, not hard sell
- [ ] Mentions proxyhubb.com (and ideally docs.proxyhubb.com)

## Optional extras

If the first generate is too shallow on “how the node works,” add as a 6th source:
- https://docs.proxyhubb.com (provider / CLI pages if indexed)
- Or paste a short excerpt from the live provider setup docs

Do **not** upload raw audit reports — they pull the tone toward unfinished risk.

## LinkedIn / YouTube pairing

Use a short caption focused on the provider side. Put `https://proxyhubb.com` in the first comment on LinkedIn.
