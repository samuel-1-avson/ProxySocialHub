# CI baseline after the Actions outage (2026-10-27)

GitHub Actions could not start jobs from about 2026-10-12 until the account block was
fixed on 2026-10-26, and the last full pass was 2026-08-13. This is the first complete
picture since then. It was produced by manual runs of **ProxyHubb CI**, which now run
every job (before this change five jobs only ran when their paths changed, so a manual
run skipped them): runs 40424005040 (devnet tooling branch) and 40426964581 (this branch).

Everything below is what the runs showed. Where a cause is inferred it says so.

## Where each job stands

| Job | Result | What it is |
| --- | --- | --- |
| Secrets & keypair gate, lint, db-migrate, docker-build | pass | |
| solana-check, Anchor tests (72 mocha tests + soak), Build CLI (linux/macos/windows), Verify CLI download API, proxyhubb-cli check, docs-check | pass | fixed in #54 and #53 |
| frontend-check | **fail** | lint, route registry and type check pass; the Playwright "Marketplace E2E" step ends **7 failed, 2 flaky, 5 did not run, 9 passed** (22 min), so `Build` and the contract checks never ran. The errors are locator drift (`strict mode violation ... resolved to 2/4 elements`, `element(s) not found`), not an outage |
| backend-test (Go) | **fail** | 45 failing tests in 6 of 41 packages, 2 data races (below) |
| edge-gateway-check | **fail** | `cargo fmt` fixed here; **Clippy: 34 errors** |
| provider-node-check | **fail** | `cargo fmt` fixed here; **Clippy: 21 errors** |
| Provider Docker E2E | **fail** | edge-gateway needs TLS certs that a CI checkout does not have |
| Security Scan: Go / Node / Rust dependency audits | **fail** | real advisories, not looked at |

`go vet`, `staticcheck` and `go build ./...` all pass; the failures are in tests.

## Go: 45 failing tests

| Package | Failing tests |
| --- | --- |
| internal/api | 29 |
| internal/billing | 9 |
| internal/governance | 3 |
| internal/worker | 2 |
| internal/notifications | 1 |
| internal/treasury | 1 |

Across the whole suite log the dominant error signatures are:

- **Tables that do not exist** in the test database: `system_configurations` (48 hits), `treasury_transactions` (15), `usage_proofs` (12), `session_metrics` (12), `escrow_transactions` (10), `explorer_transactions` (5), and eight more with 2-3 each.
- **Foreign keys to parent rows that were never created:** `fk_proxy_listings_seller` (36), `fk_orders_buyer` (11), `fk_linked_wallets_user` (3).

Why the first one happens is visible in the code: `testutil.SetupTestDB` builds the schema with
`AutoMigrate` over a hard-coded list of models, while production builds it from
`migrations/*.sql` (up to 000165). Any table that is not in that list does not exist in
the test database. The foreign keys are consistent with fixtures that insert a listing or
order for a user that was never created, plus a database shared across packages that
`go test ./...` runs in parallel with `CleanupTestData` deleting rows (inferred, not
proven: `go test ./internal/billing/...` run alone also hits `fk_orders_buyer`).

That points at test-harness drift, not 45 independent product bugs. It is **not proven for
each test**: for 36 of the 45 the log excerpt did not carry the individual error, so their
cause is unconfirmed.

**Data races (2, found by `-race`).** Both are a test replacing a package-level global
while a background goroutine started by earlier product code still reads it:
`testutil.SetupTestRedis` vs `api.PublishFeedEvent`, and `solana.SetOracleClientForTest`
vs `treasury.oracleClient`. Test isolation; they would not occur if the globals were only set at startup.

One fixture bug was fixed here: `TestCountActiveListingSessions_IgnoresDisabledAndExpired`
inserted sessions with an empty `Config`, which is invalid for the `jsonb` column.

## Rust

- **Formatting**: 13 hunks in edge-gateway and 1 in provider-node; fixed with `cargo fmt` (rustfmt 1.9.0 stable).
- **Clippy** (`-D warnings`): edge-gateway 34 errors (`too_many_arguments` 9, manual prefix stripping, `clamp`-like patterns, a very complex type, and more); provider-node 21 errors, mostly dead code (`function is never used` 10, `struct is never constructed` 3). Not touched here: `too_many_arguments` and dead code need design decisions, and some of it may be unfinished features.

## Suggested order

1. Make `testutil.SetupTestDB` apply `migrations/*.sql` (what `db-migrate` does) instead of the model list, so tests see the production schema.
2. Give each package its own database (or run `-p 1`), and fix fixtures to create their parent rows.
3. Fix the two test-isolation races.
4. Fix the Playwright locators (the page structure changed under them), then let `Build` and the contract checks run.
5. Rust Clippy backlog, then the dependency audits.

Until then CI is red for pre-existing reasons and the Go result cannot be used as a signal
about a change. The most useful thing the current run gives is the list of failing tests,
which a run of `go test ./... -count=1` in the same environment reproduces.
