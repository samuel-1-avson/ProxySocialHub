# P1 sign-off — Hot-path performance

**Status:** Signed off (2026-06-02)  
**Scope:** [`EDGE_GATEWAY_VNEXT_BLUEPRINT.md`](../../../docs/EDGE_GATEWAY_VNEXT_BLUEPRINT.md) § P1 / §5.1–§5.6  
**Exit checklist:** [`P1_EXIT_CRITERIA.md`](P1_EXIT_CRITERIA.md)

## Deliverables (code)

| Item | Location |
|------|----------|
| Debounced score snapshot | `src/registry/lockfree.rs`, `start_score_refresh` |
| Moka session cache | `src/auth.rs` |
| Log demotion (hot path) | `src/main.rs`, `src/proxy/zerocopy.rs` |
| Client-leg splice (Linux) | `src/proxy/zerocopy.rs` |
| Allocation reductions | `src/policy.rs`, `src/auth.rs`, `src/main.rs` |
| Early connection admission | `Semaphore` on accept (`main.rs`) |
| Lean default build | `Cargo.toml` `default = []`, production `Dockerfile` |

## Exit criteria

| # | Criterion | Evidence | Status |
|---|-----------|----------|--------|
| 1 | Bench smoke in CI | `.github/workflows/proxyhubb-ci.yml` → `cargo bench --bench registry_bench -- --test` + `hotpath_bench -- --test` | Pass |
| 2 | Snapshot **read** ≪ **rebuild** @ 10k | See table below; raw logs in [`P1_BASELINE.md`](P1_BASELINE.md) (2026-06-02 run) | Pass |
| 3 | Flamegraph: rebuild not on read path | Linux: `./scripts/p1-flamegraph.sh 'rebuild_snapshot/1000'` then profile `read_get_best/10000` | Optional (Linux) |
| 4 | Load / health smoke | `./scripts/p1-compose-smoke.sh` or `.\scripts\p1-compose-smoke.ps1` (resilience stack **18090**) | Pass |
| 5 | Deploy port parity | `cargo test deploy_manifests_use_canonical_ports` (+ canonical defaults, lean features) | Pass |

### Snapshot benchmark @ 10k nodes (HALLDEAN, 2026-06-02)

Criterion `hotpath_bench`, full run (not `--test`):

| Benchmark | Time (typical) | vs rebuild |
|-----------|----------------|------------|
| `score_snapshot/read_get_best/10000` | **~38 ns** | ~33,000× faster |
| `score_snapshot/rebuild_snapshot/10000` | **~1.26 ms** | (background refresh only) |
| `score_snapshot/fallback_full_scan/10000` | ~294 µs | pre-P1 scan path |

**Rule:** per-request selection must use snapshot read, not rebuild. Ratio read:rebuild ≈ **1:33,000** at 10k — satisfies “orders of magnitude.”

### CI parity (matches local `p1-exit-verify.ps1`)

| Step | CI (`edge-gateway-check`) | Local script |
|------|---------------------------|--------------|
| `cargo fmt --check` | Yes | — |
| `cargo clippy` (lean) | Yes | — |
| `cargo build` | Yes | `cargo check --bin edge-gateway` |
| `cargo test --bin edge-gateway` | Yes (all unit tests) | `deploy_manifests_*`, `default_features_are_lean`, `canonical_port_*` |
| Bench `--test` smoke | Yes | Same |
| Optional features compile | `cargo check --features legacy-zk,blockchain,pricing,ml` | — |

## Commands (repeat sign-off)

```powershell
cd services/edge-gateway
.\scripts\p1-exit-verify.ps1          # Windows: parity tests + bench --test
.\scripts\p1-record-baseline.ps1      # full timings → P1_BASELINE.md
.\scripts\p1-compose-smoke.ps1       # stack + load smoke (18090)
```

```bash
cd services/edge-gateway
./scripts/p1-exit-verify.ps1   # use pwsh, or run steps from P1_EXIT_CRITERIA.md
./scripts/p1-bench.sh
./scripts/p1-flamegraph.sh 'rebuild_snapshot/1000'
./scripts/p1-compose-smoke.sh
```

## Notes

- **Flamegraph** is not run in CI (requires Linux + `cargo flamegraph`). Sign-off accepts criterion proof; flamegraph is recommended once per platform for regression archives.
- **Full CONNECT soak** at target tunnel count remains environment-specific (needs live providers); P1 scope is hot-path microbenchmarks + health/metrics load smoke.
- Next phase: **P2** admission/resilience — [`P2_ADMISSION_RESILIENCE.md`](P2_ADMISSION_RESILIENCE.md).
