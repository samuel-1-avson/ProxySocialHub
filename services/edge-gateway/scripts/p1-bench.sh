#!/usr/bin/env bash
# P1 exit: run criterion benchmarks (selection + hot-path).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== registry_bench (baseline vs dashmap) =="
cargo bench --bench registry_bench "$@"

echo ""
echo "== hotpath_bench (snapshot read vs rebuild, domain, redis keys) =="
cargo bench --bench hotpath_bench "$@"

echo ""
echo "Results: target/criterion/<bench>/report/index.html"
