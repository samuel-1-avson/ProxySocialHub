# Secret findings in git history

Status as of 2026-10-26. Owner: repo admin. Nothing here contains a secret value,
only where one was committed and what to do about it.

A full-history gitleaks scan (the weekly **Security Scan**, or a manual run of
**ProxyHubb CI**) reports 142 findings. Pushes and PRs only scan their own new
commits, so the PR gate was not affected. The full scan stayed red because of
the findings below.

| Bucket | Count | What it is | Where it is handled |
| --- | --- | --- | --- |
| Anchor IDL seed bytes | 98 | PDA seed constants (`112,114,111,...` = ASCII `progra...`) matched by the keypair rule | Rule-level allowlist in `.gitleaks.toml` (covers future regenerated IDLs too) |
| Reviewed false positives | 26 | Placeholders, test fixtures, doc examples, public Hardhat dev keys, Supabase anon keys | `.gitleaksignore`, section A |
| Real historical leaks | 18 | Credentials committed before the June 2026 secret gates (items R1 to R8 below) | `.gitleaksignore`, section B, until rotated |

Section B only stops the scan staying red. It does not fix anything. The entries
are fingerprints that include the commit SHA, so the same material committed
again is not covered and fails the gate.

## Rotation list

| Id | Severity | What | Where in history | Action |
| --- | --- | --- | --- | --- |
| R1 | **Critical** | Oracle/admin signing key. The file is a working Ed25519 keypair for `8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2`, the oracle and config admin used on devnet and testnet (see `config/gcp-testnet.env.example` and `docs/ops/evidence/`). The seed in the file derives that public key (checked 2026-10-26). Anyone who can read this repo's history can sign as it. | `infra/oracle-keypair.json` @ `3cc998ba` (2026-01-25) | Create a fresh non-exportable KMS key, hand the oracle and admin roles to it with the program's admin handover, then update `EXPECT_PUBKEY`, `GCP_KMS_PUBLIC_KEY` and the allowlist in `.gitleaks.toml`. Must be done before mainnet. Also confirm the existing KMS key was not imported from this file. |
| R2 | **High** | A Playwright results file that dumped a developer machine's whole environment, including `OPENROUTER_API_KEY` and `ANTHROPIC_AUTH_TOKEN` (73-character `sk-...` values; the base URL length matches `https://openrouter.ai/api`, so this is probably one key listed twice). | `apps/web/test-results/results.json` @ `0b9852a8` (2026-05-10); the file was removed and gitignored on 2026-05-24 | Revoke the key(s) at the provider and issue new ones. Rotation is the only fix, since the value is in history. |
| R3 | Low | Dev mTLS CA, client and server private keys. The testnet VM serves a different Let's Encrypt key (hash-compared 2026-10-26), so these are not in use there. | `certs/ca.key`, `certs/client.key`, `certs/server.key` @ `0a401ea9` (2026-01-18) | If anything else trusts this CA, regenerate. Otherwise treat as retired. |
| R4 | Medium | Kubernetes `Secret` manifests with a Postgres password and ingress basic-auth (base64 is not encryption). | `infra/k8s/postgresql-cluster.yaml`, `infra/k8s/nginx-ingress.yaml` @ `41c8ef2` (2026-01-22) | Rotate on any cluster that was created from these manifests. The testnet VM does not use them. |
| R5 | Medium | HMAC secret hard-coded in a token helper. | `gen_token.go` @ `fc26364` (2026-03-21) | The value matches no variable in the VM's `.env*` files or running containers (hash-compared 2026-10-26). Delete the literal and read it from the environment. Rotate if it was ever a real signing secret elsewhere. |
| R6 | Low | Paystack **test-mode** secret key (`sk_test_`). | `docker-compose.dev.yml` @ `6830fb83` (2026-01-21) | Roll it in the Paystack dashboard. |
| R7 | Low | Provider session JWTs from control-api. Both are expired. | `cli/provider.toml` @ `850fe0e` and `fb83d5f`; `login_res.json` @ `4be478b` | None beyond R5. |
| R8 | Low | A 44-character base58 `provider_signing_key` in a manual. Could be a sample. | `docs/PROVIDER_CLI_AND_NODE_MANUAL.md` @ `7635bc9` | Confirm it is a sample, or rotate the provider key. |

## Checked and not a problem

- Hardhat/Anvil account #0 and #1 private keys (`docker-compose.dev.yml`, `services/relayer/main.go`) are public dev keys.
- Supabase `anon` JWTs are public by design (they ship in the client; access is enforced by RLS).
- Placeholder values (`test-...`, `YOUR_JWT_TOKEN`) in CI config, docs and test fixtures.

## History rewrite

Not done. The repo is private with no forks, and rewriting it changes every
commit SHA, which breaks open PRs, every clone and the VM checkout. Rotation (R1,
R2 first) removes the risk without that cost. Revisit if the repo is ever made
public or shared outside the team.

## Re-running the checks

```sh
# full-history scan, honouring .gitleaks.toml and .gitleaksignore
gitleaks detect --redact -v --source .
```

Never print a seed or private key while investigating. Derive and compare public
keys, or compare SHA-256 hashes, and report only yes or no.
