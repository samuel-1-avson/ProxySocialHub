# P1 exit criteria — verification guide

This documents how to close **P1 — Hot-path performance** from
[`EDGE_GATEWAY_VNEXT_BLUEPRINT.md`](../../../docs/EDGE_GATEWAY_VNEXT_BLUEPRINT.md).

## Code deliverables (implemented)

| Item | Section | Status |
|------|---------|--------|
| Debounced score snapshot | §5.1 | `registry/lockfree.rs` + `start_score_refresh` |
| Moka session cache | §5.3 | `auth.rs` |
| Log demotion | §5.4 | `main.rs`, `proxy/zerocopy.rs` |
| Client-leg splice (Linux) | §5.5 | `proxy/zerocopy.rs` |
| Allocation reductions | §5.6 | `policy.rs`, `auth.rs`, `main.rs` |
| Connection admission (early) | §5.2 partial | `Semaphore` on accept |

## Exit criteria checklist

### 1. Criterion benchmarks

```bash
cd services/edge-gateway
./scripts/p1-bench.sh
# or CI smoke:
cargo bench --bench registry_bench -- --test
cargo bench --bench hotpath_bench -- --test
```

**What to look for**

- `score_snapshot/read_get_best` — sub-microsecond to low-microseconds at 1k–10k nodes.
- `score_snapshot/rebuild_snapshot` — milliseconds at 10k nodes; acceptable **only** on the refresh interval, not per request.
- `read_get_best` should be **orders of magnitude** faster than `rebuild_snapshot` at the same N.
- `domain_rules/host_matches_any_32_rules` — stable low μs (no `format!` in loop).
- `auth_cache/moka_get_hit` — cache hit path only (no Redis); should stay sub-μs to low-μs.
- Compare `registry_bench` dashmap vs legacy mutex for concurrent selection wins.

Windows smoke (tests + bench compile + `--test`):

```powershell
.\scripts\p1-exit-verify.ps1
```

HTML reports: `target/criterion/*/report/index.html`

### 2. Flamegraph (snapshot rebuild not on hot path)

Linux:

```bash
cargo install flamegraph
./scripts/p1-flamegraph.sh 'rebuild_snapshot/1000'
```

Then open `flamegraph.svg` and confirm:

- `rebuild_score_snapshot` is visible when profiling the **rebuild** bench.
- A separate profile of `read_get_best` should **not** show full-registry sort/scan.

### 3. Load smoke (ops / CPU)

With gateway + Redis running:

```bash
./scripts/p1-load-smoke.sh
```

Or bring up the minimal test stack and run load smoke in one step:

```bash
./scripts/p1-compose-smoke.sh
# Windows:
# .\scripts\p1-compose-smoke.ps1
```

Uses `docker-compose.resilience.yml` (edge + Redis on host **18090** / **16379** by default to avoid clashing with dev compose on 8090).

Full CONNECT tunnel soak is environment-specific (providers required). Track:

- CPU per active tunnel (should drop vs pre-P1 with splice + less logging).
- Stable memory under `MAX_CONCURRENT_CONNECTIONS`.

### 4. P0 leftovers (parity + lean image)

**Port parity** — single test covers K8s, compose, Dockerfile, infra compose, `.env.example`:

```bash
cargo test --bin edge-gateway deploy_manifests_use_canonical_ports
cargo test --bin edge-gateway canonical_port_defaults_match_ecosystem
cargo test --bin edge-gateway default_features_are_lean
```

**Lean default build (ADR D4)**

- `default = []` in `Cargo.toml`; production `Dockerfile` builds without optional features.
- CI: `cargo clippy`, `cargo test`, `cargo check --features legacy-zk,blockchain,pricing,ml`.

## Sign-off

**P1 is signed off.** Recorded in [`P1_SIGNOFF.md`](P1_SIGNOFF.md) (2026-06-02).

Criteria met:

1. Bench smoke passes in CI.
2. `hotpath_bench`: snapshot **read** ≪ **rebuild** at 10k (~38 ns vs ~1.26 ms).
3. Flamegraph (Linux, optional): `./scripts/p1-flamegraph.sh` — criterion ratio satisfies read-path sign-off.
4. Load smoke: `p1-compose-smoke` on resilience stack **18090**.
5. `deploy_manifests_use_canonical_ports` (+ canonical defaults, lean features) passes.

Next phase: **P2** — see [P2_ADMISSION_RESILIENCE.md](P2_ADMISSION_RESILIENCE.md) (503 admission + session time limits + control-api :8090 started).

**Sign-off checklist:**

- [x] `p1-exit-verify.ps1` / CI bench `--test` smoke
- [x] Full criterion timings — [`P1_BASELINE.md`](P1_BASELINE.md) + [`P1_SIGNOFF.md`](P1_SIGNOFF.md)
- [x] `p1-flamegraph.sh` — optional on Linux (not in CI)
- [x] `p1-load-smoke` / `p1-compose-smoke` (resilience stack on **18090**)

Record baselines:

```powershell
.\scripts\p1-exit-verify.ps1              # recommended before release
.\scripts\p1-record-baseline.ps1 -Quick   # CI-parity (--test)
.\scripts\p1-record-baseline.ps1          # full criterion run
```
