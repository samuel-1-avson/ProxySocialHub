//! Canonical on-disk paths for provider operator files (config, PID, logs, runtime).

use std::path::PathBuf;

/// Base operator directory: `~/.proxyhubb` or `%USERPROFILE%\.proxyhubb`.
pub fn state_dir() -> PathBuf {
    home_dir().join(".proxyhubb")
}

pub fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// `~/.config/proxyhubb/provider.toml` (XDG) when available, else `~/.proxyhubb/provider.toml`.
pub fn config_file() -> PathBuf {
    if let Some(dir) = dirs::config_dir() {
        return dir.join("proxyhubb").join("provider.toml");
    }
    state_dir().join("provider.toml")
}

pub fn pid_file() -> PathBuf {
    state_dir().join("provider.pid")
}

pub fn log_file() -> PathBuf {
    state_dir().join("logs").join("provider-node.log")
}

pub fn runtime_state_file() -> PathBuf {
    state_dir().join("runtime.json")
}

/// Ensure `~/.proxyhubb` and `logs/` exist.
pub fn ensure_state_dirs() -> std::io::Result<()> {
    std::fs::create_dir_all(state_dir().join("logs"))
}

/// Append one line to the operator log (best-effort).
pub fn append_log(line: &str) {
    let _ = ensure_state_dirs();
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file())
    {
        let _ = writeln!(f, "{line}");
    }
}
