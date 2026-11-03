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

## Rolling the Explorer by hand

The public Explorer (`explorer.proxyhubb.com`, `apps/explorer`) is not part of the deploy above. It is built
into an image, copied to the VM and rolled by `scripts/gcp-roll-explorer-image.sh`, which health-checks the new
container and puts the old image and Caddy config back if anything fails. The **Deploy** workflow does this
when Actions runs. By hand, with no local Docker, it is:

1. **Run the gates on the exact revision.** Export it with LF endings (a Windows checkout is CRLF) and run what
   the workflow's validation step runs:

   ```bash
   REV=$(git rev-parse origin/main)   # the full 40-character revision, never a branch name
   git -c core.autocrlf=false -c core.eol=lf archive $REV apps/explorer packages/design-system | tar -x -C <scratch>
   cd <scratch>/apps/explorer
   npm ci && npm audit --omit=dev --audit-level=high && npm run typecheck && npm test && npm run build
   npx playwright test   # both browsers; add --project=chromium if WebKit is not installed, and say so
   ```

   The repo's secret scan only runs in Actions, so also search the tree for keys by hand.
2. **Build the image in Cloud Build** (about 2 minutes). From the repo root:

   ```bash
   git -c core.autocrlf=false -c core.eol=lf archive --format=tar.gz -o explorer-source.tgz $REV apps/explorer packages/design-system
   gcloud builds submit explorer-source.tgz --project=gen-lang-client-0022105784 \
     --config=scripts/cloudbuild-explorer.yaml --substitutions=_REVISION=$REV --async
   gcloud builds describe <build id> --project=gen-lang-client-0022105784 --format='value(status)'
   gcloud builds log <build id> --project=gen-lang-client-0022105784 | grep -E 'revision=|explorer-image.tar'
   ```

   The log's last step prints the image's revision label and the **sha256 of the tar**: copy it. Do not build
   the same revision twice, because the second build replaces the stored tar and the recorded sha256 stops
   matching.
3. **Put the image on the VM and check it.** The VM can read the release bucket:

   ```bash
   gcloud storage cp gs://gen-lang-client-0022105784_cloudbuild/proxyhubb/public-frontend-releases/$REV/explorer-image.tar /tmp/proxyhubb-explorer-$REV.tar
   echo "<sha256 from the build log>  /tmp/proxyhubb-explorer-$REV.tar" | sha256sum -c -
   ```

4. **Copy the roll script and the compose overlay from the same revision** to the VM, one `gcloud compute scp`
   per file: `scripts/gcp-roll-explorer-image.sh` as `/tmp/proxyhubb-explorer-$REV.sh` and
   `scripts/explorer-release.compose.yml` as `/tmp/proxyhubb-explorer-$REV.yml`. In Git Bash, `git show
   <rev>:<path>` needs `MSYS_NO_PATHCONV=1` in front.
5. **Roll, detached**, so a dropped SSH session cannot kill it half way (it takes about a minute):

   ```bash
   TS=$(date -u +%Y%m%dT%H%M%SZ)
   sudo systemd-run --unit=proxyhubb-explorer-roll-$TS --collect --quiet bash -c "env EXPECTED_REVISION=$REV bash /tmp/proxyhubb-explorer-$REV.sh > /var/log/proxyhubb-explorer-roll-$TS.log 2>&1; echo ROLL_EXIT=\$? >> /var/log/proxyhubb-explorer-roll-$TS.log"
   sudo tail -f /var/log/proxyhubb-explorer-roll-$TS.log
   ```

   Success ends with `Explorer staged: revision=<rev> ... rollback_image=<id>` and `ROLL_EXIT=0`. Note the
   `rollback_image`.
6. **Check by hand:** `curl https://explorer.proxyhubb.com/api/health` shows the new revision; `/`, `/nodes`,
   `/transactions`, `/analytics`, `/governance` and `/about` return 200; `sudo docker ps` shows the Explorer
   healthy and every other container with its old uptime.

The roll only recreates the Explorer container. The API and everything else keep running, and an API change
still needs the deploy above. The previous image stays on the VM as `proxyhubb-production/explorer:<old rev>`
until a later deploy's cleanup (which keeps the newest two), so an older release can be put back by running the
same steps with its revision, or by recreating the container from that tag.
