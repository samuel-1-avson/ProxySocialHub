//! Baseline performance benchmarks for edge-gateway provider selection.
//!
//! Run with:
//!   cargo bench --bench registry_bench
//!
//! These benchmarks establish the Phase 0 baseline so we can validate the
//! Phase 1 target: provider-selection time 50 μs → 5 μs (10x improvement).
//!
//! Since the main crate is a binary, the scoring/selection logic is replicated
//! here from state.rs / registry/lockfree.rs for standalone benchmarking.
//! Integration benchmarks with real yamux connections live in tests/

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use dashmap::DashMap;
use rand::seq::IteratorRandom;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

// ---------------------------------------------------------------------------
// Shared node metadata (mirrors state::NodeInfo)
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct NodeInfo {
    latency_ms: u32,
    bandwidth_rate_kbps: u32,
    active_connections: u32,
    max_connections: u32,
    connected_at: u64,
    is_healthy: bool,
}

impl NodeInfo {
    fn score(&self) -> u32 {
        if !self.is_healthy {
            return 0;
        }
        let mut score = 1000u32;
        score = score.saturating_sub(self.latency_ms);
        score = score.saturating_sub(self.bandwidth_rate_kbps / 100);
        let load = (self.active_connections * 100) / self.max_connections.max(1);
        score = score.saturating_sub(load * 5);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if (now - self.connected_at) / 3600 < 24 {
            score += 50;
        }
        score
    }
}

fn make_info(latency: u32, active: u32) -> NodeInfo {
    NodeInfo {
        latency_ms: latency,
        bandwidth_rate_kbps: 0,
        active_connections: active,
        max_connections: 200,
        connected_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        is_healthy: true,
    }
}

// ---------------------------------------------------------------------------
// Mutex<HashMap> registry — baseline (current implementation)
// ---------------------------------------------------------------------------

struct MutexRegistry {
    nodes: Mutex<HashMap<String, NodeInfo>>,
}

impl MutexRegistry {
    fn new() -> Self {
        Self {
            nodes: Mutex::new(HashMap::new()),
        }
    }

    fn insert(&self, id: String, info: NodeInfo) {
        self.nodes.lock().unwrap().insert(id, info);
    }

    fn get_best(&self) -> Option<String> {
        let nodes = self.nodes.lock().unwrap();
        nodes
            .iter()
            .filter(|(_, i)| i.is_healthy)
            .max_by_key(|(_, i)| i.score())
            .map(|(id, _)| id.clone())
    }
}

// ---------------------------------------------------------------------------
// DashMap registry — Phase 1 lock-free implementation
// ---------------------------------------------------------------------------

struct LockFreeEntry {
    info: NodeInfo,
    is_healthy: AtomicBool,
    active_connections: AtomicU32,
}

struct DashMapRegistry {
    nodes: DashMap<String, Arc<LockFreeEntry>>,
}

impl DashMapRegistry {
    fn new() -> Self {
        Self {
            nodes: DashMap::new(),
        }
    }

    fn insert(&self, id: String, info: NodeInfo) {
        let healthy = info.is_healthy;
        let active = info.active_connections;
        self.nodes.insert(
            id,
            Arc::new(LockFreeEntry {
                info,
                is_healthy: AtomicBool::new(healthy),
                active_connections: AtomicU32::new(active),
            }),
        );
    }

    fn get_best(&self) -> Option<String> {
        self.nodes
            .iter()
            .filter(|e| e.value().is_healthy.load(Ordering::Relaxed))
            .max_by_key(|e| e.value().info.score())
            .map(|e| e.key().clone())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn populate_mutex(n: usize) -> Arc<MutexRegistry> {
    let reg = Arc::new(MutexRegistry::new());
    for i in 0..n {
        reg.insert(
            format!("node-{}", i),
            make_info((i % 200) as u32, (i % 50) as u32),
        );
    }
    reg
}

fn populate_dashmap(n: usize) -> Arc<DashMapRegistry> {
    let reg = Arc::new(DashMapRegistry::new());
    for i in 0..n {
        reg.insert(
            format!("node-{}", i),
            make_info((i % 200) as u32, (i % 50) as u32),
        );
    }
    reg
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

/// Single-threaded provider selection: Mutex<HashMap> vs DashMap
fn bench_provider_selection(c: &mut Criterion) {
    let mut group = c.benchmark_group("provider_selection_single_thread");

    for &n in &[100usize, 1_000, 10_000] {
        let mutex_reg = populate_mutex(n);
        let dash_reg = populate_dashmap(n);

        group.throughput(Throughput::Elements(1));

        group.bench_with_input(
            BenchmarkId::new("mutex_hashmap", n),
            &mutex_reg,
            |b, reg| b.iter(|| black_box(reg.get_best())),
        );

        group.bench_with_input(
            BenchmarkId::new("dashmap_lockfree", n),
            &dash_reg,
            |b, reg| b.iter(|| black_box(reg.get_best())),
        );
    }

    group.finish();
}

/// Concurrent provider selection: 100 threads racing on same registry.
/// This is where the Mutex becomes the bottleneck.
fn bench_concurrent_selection(c: &mut Criterion) {
    let mut group = c.benchmark_group("provider_selection_concurrent_100_threads");

    for &n in &[1_000usize, 10_000] {
        let mutex_reg = populate_mutex(n);
        let dash_reg = populate_dashmap(n);

        group.bench_with_input(
            BenchmarkId::new("mutex_hashmap", n),
            &mutex_reg,
            |b, reg| {
                b.iter(|| {
                    let handles: Vec<_> = (0..100)
                        .map(|_| {
                            let r = reg.clone();
                            std::thread::spawn(move || black_box(r.get_best()))
                        })
                        .collect();
                    for h in handles {
                        h.join().unwrap();
                    }
                })
            },
        );

        group.bench_with_input(
            BenchmarkId::new("dashmap_lockfree", n),
            &dash_reg,
            |b, reg| {
                b.iter(|| {
                    let handles: Vec<_> = (0..100)
                        .map(|_| {
                            let r = reg.clone();
                            std::thread::spawn(move || black_box(r.get_best()))
                        })
                        .collect();
                    for h in handles {
                        h.join().unwrap();
                    }
                })
            },
        );
    }

    group.finish();
}

/// Score calculation baseline — measures pure computation without any locking.
fn bench_node_score(c: &mut Criterion) {
    let info = make_info(50, 10);
    c.bench_function("node_info_score", |b| b.iter(|| black_box(info.score())));
}

criterion_group! {
    name = benches;
    config = Criterion::default()
        .measurement_time(Duration::from_secs(5))
        .sample_size(50);
    targets =
        bench_node_score,
        bench_provider_selection,
        bench_concurrent_selection
}
criterion_main!(benches);
