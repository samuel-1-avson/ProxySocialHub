# NotebookLM Setup — ProxyHubb Video

## Video packs in this folder

| Pack | Folder | Use when |
|------|--------|----------|
| Founder / product story | files in this directory (`01`–`05` + `VIDEO_PROMPT.md`) | Broad “what is ProxyHubb / why we built it” video |
| **Provider node journey** | [`provider-node-video/`](./provider-node-video/) | Explainer on how a provider runs a node, lists capacity, and buyers reach it |

For the provider-focused video, follow **`provider-node-video/README.md`**.

---

## What this folder is for (founder story pack)
Upload these files into a new Google NotebookLM notebook, then generate a **Video Overview** using the custom prompt.

## Upload these sources (in this order)
1. `01-product-overview.md` — what ProxyHubb is
2. `02-why-we-built-it.md` — founding reason / problem
3. `03-how-it-works.md` — buyer + provider journeys
4. `04-build-adventure.md` — story backbone for the video
5. `05-safe-claims.md` — guardrails so the video doesn’t overclaim

## Optional extra sources (if you want more depth)
- https://proxyhubb.com
- https://docs.proxyhubb.com
- Root project README summary (already distilled into doc 01)

Do **not** upload raw audit reports unless you want a highly cautious / engineering-risk tone. They will pull the video toward limitations and unfinished work.

## Create the video
1. Open [NotebookLM](https://notebooklm.google.com)
2. Create notebook: `ProxyHubb — Founder Story Video`
3. Upload the 5 markdown files above
4. Open **Video Overview**
5. Choose **Customize**
6. Paste the full contents of `VIDEO_PROMPT.md`
7. Generate

## Suggested Visual style in NotebookLM
If NotebookLM offers style options, prefer:
- Documentary / explainer
- Clean diagrams over meme energy
- Serious infrastructure aesthetic, not crypto-casino aesthetic

## After generation — quick QA checklist
- [ ] Says ProxyHubb (not a random misspelling)
- [ ] Explains residential bandwidth in plain English
- [ ] Covers buyers AND providers
- [ ] Mentions edge metering / usage measurement
- [ ] Mentions wallet-native Solana without hype
- [ ] Does not invent stats or SLAs
- [ ] Ends with curiosity / explore, not hard sell
- [ ] Feels like a builder adventure, not an ad

## LinkedIn pairing
Use the video with the LinkedIn founder story post. Put `https://proxyhubb.com` in the first comment, not the post body.
