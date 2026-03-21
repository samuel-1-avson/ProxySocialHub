use serde::Serialize;
use sysinfo::System;

/// Snapshot of system resource usage.
#[derive(Debug, Clone, Serialize)]
pub struct SystemStats {
    pub cpu_percent: f32,
    pub memory_percent: f32,
    pub uptime_seconds: u64,
    pub num_cpus: usize,
    pub total_memory_mb: u64,
}

/// Collect current system statistics.
pub fn collect() -> SystemStats {
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu_percent = sys.global_cpu_usage();
    let total_mem = sys.total_memory(); // bytes
    let used_mem = sys.used_memory();
    let memory_percent = if total_mem > 0 {
        (used_mem as f64 / total_mem as f64 * 100.0) as f32
    } else {
        0.0
    };

    SystemStats {
        cpu_percent,
        memory_percent,
        uptime_seconds: System::uptime(),
        num_cpus: sys.cpus().len(),
        total_memory_mb: total_mem / (1024 * 1024),
    }
}
