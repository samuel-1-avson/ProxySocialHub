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

/// Environment variable that pins the config file for every command.
///
/// Useful for a portable install, a second node on one machine, and tests that must never
/// touch a real profile. (`dirs::config_dir()` on Windows ignores `%APPDATA%`, so redirecting
/// the environment alone does not redirect the config.)
pub const CONFIG_ENV: &str = "PROXYHUB_CONFIG";

/// The config file: `PROXYHUB_CONFIG` if set, otherwise the platform default.
///
/// On macOS `dirs::config_dir()` is `~/Library/Application Support`, not `~/.config`.
/// Prefer an existing file so dashboard scripts that still write XDG keep working.
pub fn config_file() -> PathBuf {
    config_file_from(std::env::var_os(CONFIG_ENV), config_file_candidates())
}

/// `config_file` with its inputs passed in, so the rule is testable without touching the
/// process environment.
fn config_file_from(pinned: Option<std::ffi::OsString>, candidates: Vec<PathBuf>) -> PathBuf {
    if let Some(path) = pinned.filter(|p| !p.is_empty()) {
        return PathBuf::from(path);
    }
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
    let xdg = home_dir()
        .join(".config")
        .join("proxyhubb")
        .join("provider.toml");
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn the_env_override_wins_over_every_platform_candidate() {
        let existing = std::env::temp_dir(); // a path that exists
        let got = config_file_from(
            Some(OsString::from("/pinned/provider.toml")),
            vec![existing.clone()],
        );
        assert_eq!(got, PathBuf::from("/pinned/provider.toml"));
    }

    #[test]
    fn an_empty_override_is_ignored_not_treated_as_a_path() {
        let existing = std::env::temp_dir();
        let got = config_file_from(Some(OsString::new()), vec![existing.clone()]);
        assert_eq!(got, existing);
    }

    #[test]
    fn without_an_override_an_existing_candidate_beats_the_first_one() {
        let missing = PathBuf::from("/definitely/not/here/provider.toml");
        let existing = std::env::temp_dir();
        assert_eq!(
            config_file_from(None, vec![missing.clone(), existing.clone()]),
            existing
        );
        assert_eq!(config_file_from(None, vec![missing.clone()]), missing);
    }
}
