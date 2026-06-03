# Security gates (pre-push)

Use these checks before pushing to GitHub so secrets and keypairs never land on `main`.

## Quick checklist

1. **Never commit** `.env`, `config/docker/provider.compose.env`, `*.keypair.json` (except `*.example`), `*.pem`, `jwt.txt`, or `**/provider.local*.toml`.
2. Run **`scripts/pre-commit-security.sh`** (or install [pre-commit](https://pre-commit.com/) — see `.pre-commit-config.yaml`).
3. Confirm **`git ls-files`** does not list `infra/oracle-keypair.json` or other keypairs.
4. If anything sensitive was ever pushed, **rotate** keys and generate new Solana keypairs (old ones are public in git history).

## Local commands

```bash
# Staged-file + tracked-keypair gate
./scripts/pre-commit-security.sh

# Optional: full repo secret scan (install gitleaks first)
gitleaks detect --source . --config .gitleaks.toml --verbose

# Ensure Docker oracle mount path exists
./scripts/ensure-oracle-keypair.sh
```

```powershell
.\scripts\pre-commit-security.ps1
.\scripts\ensure-oracle-keypair.ps1
```

## CI

| Workflow | When | What |
|----------|------|------|
| [`.github/workflows/proxyhubb-ci.yml`](../.github/workflows/proxyhubb-ci.yml) | Every push/PR to `main`/`develop` | `secrets-gate` job: blocks tracked keypairs + Gitleaks |
| [`.github/workflows/security.yml`](../.github/workflows/security.yml) | Push/PR + weekly | Gitleaks, TruffleHog, CodeQL, dependency audits |

## Oracle keypair

See [`infra/README.md`](../infra/README.md). Production must use a secrets manager, not a committed JSON file.
