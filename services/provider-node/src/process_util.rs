use sysinfo::{Pid, ProcessesToUpdate, System};

pub fn process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]));
    sys.process(Pid::from_u32(pid)).is_some()
}

/// True when PID is alive AND looks like a ProxyHubb provider binary.
/// Prevents Windows PID reuse from reporting a false "daemon running".
pub fn provider_process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]));
    let Some(proc) = sys.process(Pid::from_u32(pid)) else {
        return false;
    };
    let name = proc.name().to_string_lossy().to_ascii_lowercase();
    let exe = proc
        .exe()
        .map(|p| p.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    is_provider_process_name(&name) || is_provider_process_name(&exe)
}

fn is_provider_process_name(s: &str) -> bool {
    s.contains("provider-node")
        || s.contains("provider_node")
        || s.contains("proxyhubb-cli")
        || s.contains("proxyhubb_cli")
}

/// Classify whether a live PID is our daemon, a reused foreign process, or gone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PidLiveness {
    ProviderAlive,
    ForeignAlive,
    Dead,
}

pub fn classify_pid(pid: u32) -> PidLiveness {
    if pid == 0 {
        return PidLiveness::Dead;
    }
    if provider_process_alive(pid) {
        PidLiveness::ProviderAlive
    } else if process_alive(pid) {
        PidLiveness::ForeignAlive
    } else {
        PidLiveness::Dead
    }
}

pub fn read_pid_file() -> Option<u32> {
    let path = crate::paths::pid_file();
    let raw = std::fs::read_to_string(path).ok()?;
    let pid: u32 = raw.trim().parse().ok()?;
    if pid > 0 {
        Some(pid)
    } else {
        None
    }
}

/// PID recorded on disk but no live provider process (crashed, killed, or PID reused).
pub fn stale_pid_in_file() -> Option<u32> {
    read_pid_file().filter(|&pid| classify_pid(pid) != PidLiveness::ProviderAlive)
}

/// Remove a stale PID file; returns the dead PID that was cleared.
pub fn remove_stale_pid_file() -> Option<u32> {
    if let Some(stale) = stale_pid_in_file() {
        let path = crate::paths::pid_file();
        let _ = std::fs::remove_file(path);
        return Some(stale);
    }
    // Docker restarts reuse PID 1; a leftover provider.pid blocks unless-stopped loops.
    if std::path::Path::new("/.dockerenv").exists() && read_pid_file() == Some(1) {
        let path = crate::paths::pid_file();
        let _ = std::fs::remove_file(path);
        return Some(1);
    }
    None
}
