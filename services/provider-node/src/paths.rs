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

/// Platform default `provider.toml`.
///
/// On macOS `dirs::config_dir()` is `~/Library/Application Support`, not `~/.config`.
/// Prefer an existing file so dashboard scripts that still write XDG keep working.
pub fn config_file() -> PathBuf {
    let candidates = config_file_candidates();
    for path in &candidates {
        if path.exists() {
            return path.clone();
        }
    }
    candidates
        .into_iter()
        .next()
        .unwrap_or_else(|| state_dir().join("provider.toml"))
}

pub fn config_file_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(dir) = dirs::config_dir() {
        out.push(dir.join("proxyhubb").join("provider.toml"));
    }
    let xdg = home_dir().join(".config").join("proxyhubb").join("provider.toml");
    if !out.iter().any(|p| p == &xdg) {
        out.push(xdg);
    }
    if out.is_empty() {
        out.push(state_dir().join("provider.toml"));
    }
    out
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
