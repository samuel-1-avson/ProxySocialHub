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
