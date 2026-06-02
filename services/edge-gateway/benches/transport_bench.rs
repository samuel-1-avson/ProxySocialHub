//! P4 transport hot-path microbenchmarks (yamux lane selection index).

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use std::sync::atomic::{AtomicUsize, Ordering};

fn bench_mux_lane_index(c: &mut Criterion) {
    let next = AtomicUsize::new(0);
    let lane_count = 4usize;
    c.bench_function("yamux_mux_round_robin_index_4lanes", |b| {
        b.iter(|| {
            let idx = next.fetch_add(1, Ordering::Relaxed) % lane_count;
            black_box(idx)
        });
    });
}

criterion_group!(transport_benches, bench_mux_lane_index);
criterion_main!(transport_benches);
