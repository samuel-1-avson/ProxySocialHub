use crate::{config, doctor, paths, runtime_state};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const LOG_TAIL_LINES: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportBundle {
    pub generated_at_unix: u64,
    pub config_path: String,
    pub redacted_config: String,
    pub doctor: doctor::DoctorReport,
    pub runtime_state: Option<runtime_state::RuntimeState>,
    pub log_path: String,
    pub log_tail: Vec<String>,
}

pub async fn export(config_path: PathBuf, output: Option<PathBuf>) -> Result<PathBuf> {
    let output_path = output.unwrap_or_else(default_output_path);
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let config_path_str = config_path.to_string_lossy().into_owned();
    let raw_config = std::fs::read_to_string(&config_path).unwrap_or_default();
    let runtime_path = paths::runtime_state_file();
    let log_path = paths::log_file();

    let bundle = SupportBundle {
        generated_at_unix: runtime_state::unix_now(),
        config_path: config_path_str,
        redacted_config: redact_config(&raw_config),
        doctor: doctor::run(config_path).await?,
        runtime_state: runtime_state::RuntimeState::read(&runtime_path),
        log_path: log_path.to_string_lossy().into_owned(),
        log_tail: read_log_tail(&log_path),
    };

    let body = serde_json::to_string_pretty(&bundle)?;
    std::fs::write(&output_path, body)
        .with_context(|| format!("write support bundle to {}", output_path.to_string_lossy()))?;
    Ok(output_path)
}

fn default_output_path() -> PathBuf {
    paths::state_dir().join(format!("support-bundle-{}.json", runtime_state::unix_now()))
}

fn read_log_tail(path: &std::path::Path) -> Vec<String> {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut lines = contents
        .lines()
        .map(redact_runtime_line)
        .collect::<Vec<_>>();
    if lines.len() > LOG_TAIL_LINES {
        lines = lines.split_off(lines.len() - LOG_TAIL_LINES);
    }
    lines
}

fn redact_config(raw: &str) -> String {
    raw.lines()
        .map(|line| {
            let trimmed = line.trim_start();
            let key = trimmed.split_once('=').map(|(k, _)| k.trim());
            match key {
                Some("api_key" | "jwt_token" | "provider_signing_key") => {
                    let prefix_len = line.len() - trimmed.len();
                    format!(
                        "{}{} = \"<redacted>\"",
                        " ".repeat(prefix_len),
                        key.unwrap()
                    )
                }
                _ => redact_runtime_line(line),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn redact_runtime_line(line: &str) -> String {
    line.split_whitespace()
        .map(|part| {
            if part.starts_with("api_key=")
                || part.starts_with("jwt_token=")
                || part.starts_with("provider_signing_key=")
                || part.starts_with("Authorization:")
            {
                "<redacted>".to_string()
            } else {
                redact_token_like(part)
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn redact_token_like(value: &str) -> String {
    if value.len() >= 48 && value.chars().all(|c| c.is_ascii_hexdigit()) {
        return format!("{}...<redacted>", &value[..6]);
    }
    value.to_string()
}

pub fn print_created(path: &std::path::Path) {
    println!("Support bundle written to {}", path.display());
    println!("It includes redacted config, doctor JSON, log tail, and runtime state.");
}

#[allow(dead_code)]
fn _assert_config_loads_for_support(path: &std::path::Path) -> Result<config::Config> {
    config::Config::load(&path.to_string_lossy())
}
