use sysinfo::{Pid, ProcessesToUpdate, System};

pub fn process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]));
    sys.process(Pid::from_u32(pid)).is_some()
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

/// PID recorded on disk but no live process (crashed or killed without `stop`).
pub fn stale_pid_in_file() -> Option<u32> {
    read_pid_file().filter(|&pid| !process_alive(pid))
}

/// Remove a stale PID file; returns the dead PID that was cleared.
pub fn remove_stale_pid_file() -> Option<u32> {
    if let Some(stale) = stale_pid_in_file() {
        let path = crate::paths::pid_file();
        let _ = std::fs::remove_file(path);
        return Some(stale);
    }
    // Docker restarts reuse PID 1; a leftover provider.pid blocks unless-stopped loops.
    if std::path::Path::new("/.dockerenv").exists() {
        if read_pid_file() == Some(1) {
            let path = crate::paths::pid_file();
            let _ = std::fs::remove_file(path);
            return Some(1);
        }
    }
    None
}
