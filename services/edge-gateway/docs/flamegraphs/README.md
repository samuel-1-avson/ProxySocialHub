# P1 flamegraph archive

Linux-only profiling for hot-path verification. The gateway read path (`get_best_snapshot`) should dominate; `rebuild_score_snapshot` should appear only on background refresh.

## Generate

```bash
cd services/edge-gateway
cargo install flamegraph   # once
echo -1 | sudo tee /proc/sys/kernel/perf_event_paranoid   # if perf denied

./scripts/p1-flamegraph.sh 'rebuild_snapshot/1000'
./scripts/p1-flamegraph.sh 'read_get_best/10000'
```

The script auto-copies each run to `docs/flamegraphs/YYYY-MM-DD-<filter>.svg`.

## Manual archive (CI or release)

Copy artifacts into this directory with a dated prefix:

```bash
cp flamegraph.svg "docs/flamegraphs/$(date -u +%Y-%m-%d)-rebuild_snapshot-1000.svg"
cp flamegraph.svg "docs/flamegraphs/$(date -u +%Y-%m-%d)-read_get_best-10000.svg"
git add docs/flamegraphs/*.svg
```

Large SVGs may stay in CI artifacts only; keep this README + one reference SVG under ~500 KiB if committed.

## Sign-off criterion

See [`P1_SIGNOFF.md`](../P1_SIGNOFF.md): flamegraph shows rebuild **not** on the per-request read path.
