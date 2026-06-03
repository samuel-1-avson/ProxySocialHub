#!/usr/bin/env bash
# Profile score-snapshot rebuild (should NOT dominate per-request paths).
#
# Prerequisites (Linux):
#   cargo install flamegraph
#   echo -1 | sudo tee /proc/sys/kernel/perf_event_paranoid   # if perf denied
#
# Usage:
#   ./scripts/p1-flamegraph.sh
#   xdg-open flamegraph.svg

set -euo pipefail
cd "$(dirname "$0")/.."

BENCH_FILTER="${1:-rebuild_snapshot/1000}"

echo "Profiling: hotpath_bench filter '$BENCH_FILTER'"
echo "Expect rebuild_score_snapshot in flamegraph; get_best_snapshot should be tiny."

cargo flamegraph --bench hotpath_bench -- --profile-time 5 "$BENCH_FILTER"

ARCHIVE_DIR="docs/flamegraphs"
mkdir -p "$ARCHIVE_DIR"
STAMP=$(date -u +%Y-%m-%d)
SAFE_FILTER=$(echo "$BENCH_FILTER" | tr '/ ' '__')
cp -f flamegraph.svg "${ARCHIVE_DIR}/${STAMP}-${SAFE_FILTER}.svg"
echo "Archived ${ARCHIVE_DIR}/${STAMP}-${SAFE_FILTER}.svg"

echo "Wrote flamegraph.svg — search for rebuild_score_snapshot vs get_best_snapshot"
