# ProxyHubb status — 2026-08-08 (post BC-11 Sprint A)

## Progress right now

| Layer | State |
|-------|--------|
| **gcp-testnet (`proxyhubb-testnet`)** | Controlled Testnet: custody split live, BC-05/06 settle live, challenge window live, BC-11 Phase-1 + Sprint A code landed (Halo2 off-chain prove/verify) |
| **Decentralization** | ~hybrid (~2.5–3/5): money path escrow + multisig settle; metering/reputation still oracle-attested |
| **Mainnet / production cutover** | **Not ready** — do not treat Testnet work as production certification |

## Improvements this arc

1. **Challenge window** before auto-release + dispute gate  
2. **BC-06** multisig settle (nonce bump) + release/auto-release/usage paths  
3. **BC-08** custody: vault ≠ hot ≠ oracle ≠ cold (KMS) — re-verified PASS  
4. **BC-13** admin-cli destructive CleanupDb guards  
5. **BC-11 Phase-1**: `SubmitZKBatch` Ed25519 + `proof_hash`; FE trustless de-claim  
6. **BC-11 Sprint A**: stable Halo2 params, `/v1/verify`, verify-before-submit, reputation crate rebuild, Groth16 path doc  

## Is production perfect?

**No.**

- Evidence in this arc targets **proxyhubb-testnet**, not a fresh `proxyhubb.com` production audit.  
- Still open: Slack/PD alerts, journal drift triage, Redis HA, IMAGE_TAG rollback drills, full BC-11 Groth16 on-chain.  
- Honest product language: **oracle-attested Merkle anchors**, not trustless ZK.

## GitHub / secrets hygiene

| Check | Result |
|-------|--------|
| Remote | `origin` → `https://github.com/samuel-1-avson/ProxySocialHub.git` |
| Branch | `main` was **ahead of `origin/main` by 2** local commits; large **uncommitted** working tree |
| Pushed? | **Most Phase B / BC-11 work is NOT on GitHub yet** (uncommitted). Do not assume remote matches local. |
| Secrets gitignore | Extended: `.deploy-stage*/`, `*.tar.gz` deploy artifacts, `.zk-keys/`, `params.bin`/`vk.bin`/`pk.bin`, existing `*keypair*.json`, `.env*`, `secrets/`, `jwt.txt` |
| Docs | `docs/**` allowlisted so evidence can be committed without enabling all `*.md` |
| Push | **Not performed** — push only after curated commit + your explicit “push” |

### Before any push (checklist)

1. `git status` — ensure no `*keypair*`, `.env`, `secrets/`, deploy tarballs staged  
2. `git check-ignore -v path` for suspicious files  
3. Curate commit: source + `docs/ops` evidence + scripts — exclude `.deploy-stage*`, `*.tar.gz`  
4. Explicit user approval to `git push`
