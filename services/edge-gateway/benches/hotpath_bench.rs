//! P1 hot-path benchmarks: score snapshot, domain rules, Redis key formatting.
//!
//! Run:
//!   cargo bench --bench hotpath_bench
//!   cargo bench --bench hotpath_bench -- score_snapshot   # subset
//!
//! Compare `score_snapshot_read` vs `score_snapshot_rebuild` — rebuild should only
//! appear in flamegraphs on the background refresh task, not on per-request `get_best`.

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use dashmap::DashMap;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc, RwLock,
};
use std::time::Duration;

// ---------------------------------------------------------------------------
// Mirrors `registry/lockfree.rs` scoring (no yamux::Control — use unit stub).
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct BenchNodeInfo {
    latency_ms: u32,
    bandwidth_rate_kbps: u32,
    active_connections: u32,
    max_connections: u32,
    quality_score: f64,
}

struct BenchEntry {
    info: RwLock<BenchNodeInfo>,
    is_healthy: AtomicBool,
    active_connections: AtomicU32,
}

impl BenchEntry {
    fn score(&self) -> u32 {
        if !self.is_healthy.load(Ordering::Relaxed) {
            return 0;
        }
        let Ok(info) = self.info.read() else {
            return 0;
        };
        let mut score = (info.quality_score * 10.0) as u32;
        score = score.saturating_sub(info.latency_ms);
        score = score.saturating_sub(info.bandwidth_rate_kbps / 100);
        let active = self.active_connections.load(Ordering::Relaxed);
        let load_percent = (active * 100) / info.max_connections.max(1);
        score = score.saturating_sub(load_percent * 5);
        score
    }
}

struct SnapshotRegistry {
    nodes: DashMap<String, Arc<BenchEntry>>,
    top_nodes: RwLock<Vec<String>>,
    snapshot_dirty: AtomicBool,
}

impl SnapshotRegistry {
    fn new() -> Self {
        Self {
            nodes: DashMap::new(),
            top_nodes: RwLock::new(Vec::new()),
            snapshot_dirty: AtomicBool::new(true),
        }
    }

    fn insert(&self, id: String, info: BenchNodeInfo) {
        let healthy = true;
        let active = info.active_connections;
        self.nodes.insert(
            id,
            Arc::new(BenchEntry {
                info: RwLock::new(info),
                is_healthy: AtomicBool::new(healthy),
                active_connections: AtomicU32::new(active),
            }),
        );
        self.snapshot_dirty.store(true, Ordering::Release);
    }

    fn rebuild_score_snapshot(&self) {
        let mut scored: Vec<(u32, String)> = self
            .nodes
            .iter()
            .filter_map(|e| {
                if !e.value().is_healthy.load(Ordering::Relaxed) {
                    return None;
                }
                Some((e.value().score(), e.key().clone()))
            })
            .collect();
        scored.sort_unstable_by(|a, b| b.0.cmp(&a.0));
        let snapshot: Vec<String> = scored.into_iter().map(|(_, id)| id).collect();
        if let Ok(mut top) = self.top_nodes.write() {
            *top = snapshot;
        }
        self.snapshot_dirty.store(false, Ordering::Release);
    }

    /// P1 fast path: O(1) read from pre-sorted snapshot.
    fn get_best_snapshot(&self) -> Option<String> {
        let top = self.top_nodes.read().ok()?;
        top.first().cloned()
    }

    /// Pre-P1 fallback: full registry scan.
    fn get_best_scan(&self) -> Option<String> {
        self.nodes
            .iter()
            .filter(|e| e.value().is_healthy.load(Ordering::Relaxed))
            .max_by_key(|e| e.value().score())
            .map(|e| e.key().clone())
    }
}

fn make_info(i: usize) -> BenchNodeInfo {
    BenchNodeInfo {
        latency_ms: (i % 200) as u32,
        bandwidth_rate_kbps: (i % 500) as u32,
        active_connections: (i % 50) as u32,
        max_connections: 200,
        quality_score: 80.0 + (i % 20) as f64,
    }
}

fn populate_registry(n: usize) -> Arc<SnapshotRegistry> {
    let reg = Arc::new(SnapshotRegistry::new());
    for i in 0..n {
        reg.insert(format!("node-{i}"), make_info(i));
    }
    reg.rebuild_score_snapshot();
    reg
}

// ---------------------------------------------------------------------------
// Domain + Redis key helpers (mirror `policy.rs` / `auth.rs` hot paths)
// ---------------------------------------------------------------------------

#[inline]
fn host_matches_domain_rule(host: &str, domain: &str) -> bool {
    if host == domain {
        return true;
    }
    let need = domain.len().saturating_add(1);
    host.len() > need
        && host.as_bytes().get(host.len() - need) == Some(&b'.')
        && host.ends_with(domain)
}

fn host_matches_any_domain_rule(host: &str, rules: &[String]) -> bool {
    rules.iter().any(|d| host_matches_domain_rule(host, d))
}

fn redis_session_key(username: &str) -> String {
    let mut key = String::with_capacity(8 + username.len());
    key.push_str("session:");
    key.push_str(username);
    key
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

fn bench_score_snapshot(c: &mut Criterion) {
    let mut group = c.benchmark_group("score_snapshot");
    group.throughput(Throughput::Elements(1));

    for &n in &[100usize, 1_000, 10_000] {
        let reg = populate_registry(n);

        group.bench_with_input(BenchmarkId::new("read_get_best", n), &reg, |b, reg| {
            b.iter(|| black_box(reg.get_best_snapshot()))
        });

        group.bench_with_input(BenchmarkId::new("fallback_full_scan", n), &reg, |b, reg| {
            b.iter(|| black_box(reg.get_best_scan()))
        });

        let reg_rebuild = populate_registry(n);
        group.bench_with_input(
            BenchmarkId::new("rebuild_snapshot", n),
            &reg_rebuild,
            |b, reg| {
                b.iter(|| {
                    reg.snapshot_dirty.store(true, Ordering::Release);
                    reg.rebuild_score_snapshot();
                })
            },
        );
    }

    group.finish();
}

fn bench_domain_rules(c: &mut Criterion) {
    let rules: Vec<String> = (0..32)
        .map(|i| format!("allowed-{i}.example.com"))
        .collect();
    let host = "api.allowed-17.example.com";

    let mut group = c.benchmark_group("domain_rules");
    group.throughput(Throughput::Elements(1));
    group.bench_function("host_matches_any_32_rules", |b| {
        b.iter(|| black_box(host_matches_any_domain_rule(host, &rules)))
    });
    group.finish();
}

fn bench_auth_cache_lookup(c: &mut Criterion) {
    // Mirrors moka session cache read path (P1 §5.3) without Redis I/O.
    let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
    let cache: moka::future::Cache<String, u64> =
        moka::future::Cache::builder().max_capacity(10_000).build();
    rt.block_on(async {
        for i in 0..10_000 {
            cache.insert(format!("session-{i}"), i as u64).await;
        }
    });

    let mut group = c.benchmark_group("auth_cache");
    group.throughput(Throughput::Elements(1));
    let lookup_key: String = "session-5000".into();
    group.bench_function("moka_get_hit", |b| {
        b.iter(|| {
            rt.block_on(async {
                black_box(cache.get(&lookup_key).await);
            })
        });
    });
    group.finish();
}

fn bench_redis_keys(c: &mut Criterion) {
    let username = "buyer-session-7f3a9c2e1b";

    let mut group = c.benchmark_group("redis_keys");
    group.throughput(Throughput::Elements(1));
    group.bench_function("session_key_with_capacity", |b| {
        b.iter(|| black_box(redis_session_key(username)))
    });
    group.finish();
}

fn bench_concurrent_snapshot_read(c: &mut Criterion) {
    let reg = populate_registry(1_000);
    let mut group = c.benchmark_group("score_snapshot_concurrent_read");
    group.bench_function("100_threads_get_best", |b| {
        b.iter(|| {
            let handles: Vec<_> = (0..100)
                .map(|_| {
                    let r = reg.clone();
                    std::thread::spawn(move || black_box(r.get_best_snapshot()))
                })
                .collect();
            for h in handles {
                h.join().unwrap();
            }
        })
    });
    group.finish();
}

criterion_group! {
    name = benches;
    config = Criterion::default()
        .measurement_time(Duration::from_secs(3))
        .sample_size(30);
    targets =
        bench_score_snapshot,
        bench_domain_rules,
        bench_auth_cache_lookup,
        bench_redis_keys,
        bench_concurrent_snapshot_read
}
criterion_main!(benches);
