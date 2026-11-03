# Manual CI gate (while GitHub Actions billing is blocked)

All workflow runs currently end in `startup_failure` after 0s: runners never
start. DCO and GitGuardian still run and must stay green. Until billing is
restored, run the equivalent of `proxyhubb-ci.yml` by hand before merging.

To restore CI: GitHub org/repo Settings -> Billing -> fix the payment method,
then re-run any failed workflow. No workflow changes are needed.

## Rules

- No merge without the gates for every touched area below.
- `git commit -s` every commit (DCO).
- Do not merge with a red GitGuardian check. If it flags a test-only fixture
  secret, remove the blob from the branch (do not just delete the file at
  head: GitGuardian scans every commit in the range).

## Web (`apps/web`, runs on Windows)

```powershell
cd apps/web
npm run lint
npm run validate:routes
npm run typecheck
npm run test:e2e:marketplace   # playwright; needs port 4011 free
npm run build
```

Port 4011 conflicts: another run may own it. Either wait or start an isolated
server (`next dev -p <free-port> --webpack` with `JWT_SECRET`,
`TEST_JWT_SECRET`, `PLAYWRIGHT_E2E_AUTH_BYPASS=1`,
`NEXT_PUBLIC_PLAYWRIGHT_E2E_MOCK_BUY=1`) and set `TEST_BASE_URL` to it.
Always delete `.next/` before the first e2e boot after a branch switch:
a stale middleware bundle can pin an old `JWT_SECRET` and every
authenticated spec then fails at sign-in.

Node contract tests (run the ones near your change):

```powershell
node --test scripts/listing-signer.test.mjs
npm run test:listing-display
npm run test:provider-config
```

## Extension (`apps/extension`, runs on Windows)

```powershell
cd apps/extension
npm test   # hmac + verify + reliability + bridge + tsc
```

## Control API (`services/control-api`, runs on the VM)

No local Go toolchain: run inside a `golang` container on
`proxyhubb-testnet` against the VM postgres. Ship the branch with
`git archive` (full tree: the test harness needs `infra/postgres/init/`).

```bash
# gofmt: archives made on Windows carry CRLF, which gofmt flags everywhere.
# Verify formatting from LF sources instead, per file:
git show <rev>:services/control-api/<path> | gofmt -l /dev/stdin
# (empty output = clean; compare against the pre-change rev to tell
# pre-existing flags from new ones)

go vet ./...
go test -count=1 -run '<your tests>' ./internal/api/ ./internal/middleware/
```

DB-backed tests need `TEST_DATABASE_URL` with a database name containing
`test` (the harness refuses anything else so prod can never be wiped),
reachable over `--network host`, e.g.:

```bash
TEST_DATABASE_URL="host=127.0.0.1 user=proxyhubb password='<from .env>' dbname=proxyhubb_test port=55432 sslmode=disable"
```

Quote the password for the kv DSN and `DROP DATABASE` the scratch DBs after.

## Rust: edge-gateway, provider-node, proxyhubb-cli (runs on the VM)

No local cargo: run inside a `rust:bookworm` container on the VM
(`PATH=/usr/local/cargo/bin` first if needed):

```bash
cargo fmt -- --check
cargo test --locked --offline
cargo clippy -- -D warnings
```

Provider-node TUI tests: `cargo test --locked --offline` in `cli/`.
Edge-gateway: `cargo test --verbose --bin edge-gateway`.

## Provider desktop app (`apps/provider-app`)

```bash
npm ci
node scripts/build-sidecar.mjs --placeholder
cargo fmt -- --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

Full installer builds stay manual (NSIS on Windows runners when CI returns).

## Solana / Anchor

`anchor test` needs the Solana toolchain on the VM. Until that is set up,
anchor changes merge only with a maintainer's explicit sign-off in the PR.

## Docker images and migrations

`scripts/gcp-ci-deploy.sh` already builds images, runs `db-migrate`, waits for
healthy services, and smoke-checks HTTP. A successful deploy is the gate.

## Deploying by hand

While the deploy workflow cannot start, merging to `main` does not update testnet. Deploy over SSH
(`gcloud compute ssh proxyhubb-testnet --zone=us-central1-a`), in this order. On Windows, put scripts on the
VM with `gcloud compute scp` first: piping a script into `gcloud compute ssh` fails.

1. **Back up the database** (about 3 minutes and 0.6 GB; keeps the newest 3 dumps, see the script header):

   ```bash
   cd /opt/proxyhubb && sudo git fetch origin main && sudo git reset --hard origin/main
   bash scripts/gcp-pre-deploy-backup.sh
   ```

2. **Run the deploy detached**, so a dropped SSH session cannot kill it half way (the web rebuild takes
   about 20 minutes on this disk):

   ```bash
   sudo systemd-run --unit=proxyhubb-manual-deploy --collect --working-directory=/opt/proxyhubb \
     bash -c "git fetch origin main && git reset --hard origin/main && bash scripts/gcp-ci-deploy.sh --services 'db-migrate control-api web docs' >> /var/log/proxyhubb-deploy.log 2>&1; echo DEPLOY_EXIT \$? >> /var/log/proxyhubb-deploy.log"
   sudo tail -f /var/log/proxyhubb-deploy.log
   ```

3. **Read the result.** Success ends with `Deployment successfully completed and verified!`, then
   `[6/6] Freeing disk` and `DEPLOY_EXIT 0`. Migrations run UP only.
4. **Check by hand:** `curl https://api.proxyhubb.com/health`, a few site pages, and `sudo docker ps` (every
   container healthy, none restarting).

`scripts/gcp-ci-deploy.sh` looks after disk space itself. Below 10 GB free it clears build cache older than
24 h and old rollout images before building; below 6 GB it drops all unused build cache (the next build is
slower); if that is still not enough it stops before touching the running stack. It never removes anything a
container uses. The limits are environment variables (`DEPLOY_MIN_FREE_GB`, `DEPLOY_HARD_MIN_FREE_GB`,
`DEPLOY_PRUNE_CACHE_UNUSED_FOR`).
