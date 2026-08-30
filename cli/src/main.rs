use clap::{Parser, Subcommand};
use colored::*;
use indicatif::{ProgressBar, ProgressStyle};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

const DEFAULT_METRICS_PORT: u16 = 9090;

#[derive(Parser)]
#[command(name = "proxyhubb-cli")]
#[command(
    about = "ProxyHubb provider onboarding helper (production daemon: provider-node)",
    long_about = None
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Join the ProxyHubb network as a provider (writes config outside the repo)
    Join {
        /// Control API URL
        #[arg(long, default_value = "http://localhost:18080")]
        api_url: String,

        /// Provider API key
        #[arg(short, long)]
        key: String,

        /// Gateway tunnel address (host:port, not the buyer HTTP proxy port)
        #[arg(short, long, default_value = "localhost:3128")]
        gateway: String,

        /// Use an existing dashboard node UUID instead of registering a new node
        #[arg(long)]
        node_id: Option<String>,

        /// Config output path (default: platform config dir)
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    /// Start the provider-node daemon (must be installed or on PATH)
    Start {
        /// Path to configuration file
        #[arg(short, long)]
        config: Option<PathBuf>,
    },

    /// Stop the provider-node daemon (clears stale PID if process already exited)
    Stop,
    /// Operator status via provider-node (process, API nodes, metrics)
    Status {
        /// Path to configuration file
        #[arg(short, long)]
        config: Option<PathBuf>,

        /// Override metrics port
        #[arg(long)]
        metrics_port: Option<u16>,

        /// Emit JSON
        #[arg(long)]
        json: bool,
    },

    /// Pre-flight checks (delegates to provider-node doctor)
    Doctor {
        #[arg(short, long)]
        config: Option<PathBuf>,
        #[arg(long)]
        json: bool,
    },

    /// Live terminal dashboard (delegates to provider-node dashboard)
    Dashboard {
        #[arg(short, long)]
        config: Option<PathBuf>,
        #[arg(long, default_value_t = 1000)]
        refresh_ms: u64,
    },

    /// Refresh status until Ctrl+C (delegates to provider-node watch)
    Watch {
        #[arg(short, long)]
        config: Option<PathBuf>,
        #[arg(long, default_value_t = 2000)]
        interval_ms: u64,
    },

    /// Print install paths and hints (delegates to provider-node install)
    Install,

    /// Show canonical config / state paths
    Paths,
}

#[derive(Debug, Serialize, Deserialize)]
struct ProviderConfig {
    control_api_url: String,
    gateway_addr: String,
    jwt_token: String,
    api_key: String,
    node_id: String,
    provider_signing_key: String,
    connection_type: String,
    use_tls: bool,
    #[serde(default = "default_metrics_port")]
    metrics_port: u16,
}

fn default_metrics_port() -> u16 {
    DEFAULT_METRICS_PORT
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Join {
            api_url,
            key,
            gateway,
            node_id,
            output,
        } => {
            if let Err(e) = handle_join(&api_url, &key, &gateway, node_id.as_deref(), output).await
            {
                eprintln!("{} {}", "Registration failed:".red().bold(), e);
                std::process::exit(1);
            }
        }
        Commands::Start { config } => {
            let path = config
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(default_config_path);
            if let Err(e) = handle_start(&path) {
                eprintln!("{} {}", "Failed to start provider-node:".red().bold(), e);
                std::process::exit(1);
            }
        }
        Commands::Stop => {
            if let Err(e) = delegate_provider_node(&["stop"]) {
                eprintln!("{} {}", "Stop failed:".red().bold(), e);
                std::process::exit(1);
            }
        }
        Commands::Status {
            config,
            metrics_port,
            json,
        } => {
            let path = config_path_arg(config);
            if let Err(e) = delegate_provider_node_status(&path, metrics_port, json) {
                eprintln!("{} {}", "Status failed:".red().bold(), e);
                std::process::exit(1);
            }
        }
        Commands::Doctor { config, json } => {
            let path = config_path_arg(config);
            if let Err(e) = delegate_provider_node(&[
                "doctor",
                "--config",
                &path,
                if json { "--json" } else { "" },
            ]) {
                eprintln!("{} {}", "Doctor failed:".red().bold(), e);
                std::process::exit(1);
            }
        }
        Commands::Dashboard { config, refresh_ms } => {
            let path = config_path_arg(config);
            let ms = refresh_ms.to_string();
            if let Err(e) =
                delegate_provider_node(&["dashboard", "--config", &path, "--refresh-ms", &ms])
            {
                eprintln!("{} {}", "Dashboard failed:".red().bold(), e);
                std::process::exit(1);
            }
        }
        Commands::Watch {
            config,
            interval_ms,
        } => {
            let path = config_path_arg(config);
            let ms = interval_ms.to_string();
            if let Err(e) =
                delegate_provider_node(&["watch", "--config", &path, "--interval-ms", &ms])
            {
                eprintln!("{} {}", "Watch failed:".red().bold(), e);
                std::process::exit(1);
            }
        }
        Commands::Install => {
            if let Err(e) = delegate_provider_node(&["install"]) {
                eprintln!("{} {}", "Install failed:".red().bold(), e);
                std::process::exit(1);
            }
        }
        Commands::Paths => {
            print_paths();
        }
    }
}

fn config_path_arg(config: Option<PathBuf>) -> String {
    config
        .unwrap_or_else(default_config_file)
        .to_string_lossy()
        .into_owned()
}

fn state_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".proxyhubb")
}

fn print_paths() {
    let config = default_config_file();
    println!("{}", "ProxyHubb provider paths".bold().cyan());
    println!("  Config:   {}", config.display());
    println!("  State:    {}", state_dir().display());
    println!("  PID:      {}", state_dir().join("provider.pid").display());
    println!("  Runtime:  {}", state_dir().join("runtime.json").display());
    println!(
        "  Logs:     {}",
        state_dir().join("logs").join("provider-node.log").display()
    );
}

fn delegate_provider_node_status(
    config: &str,
    metrics_port: Option<u16>,
    json: bool,
) -> anyhow::Result<()> {
    let port = metrics_port
        .map(|p| p.to_string())
        .unwrap_or_else(|| read_metrics_port(Path::new(config)).to_string());
    let mut args = vec![
        "status".to_string(),
        "--config".to_string(),
        config.to_string(),
        "--metrics-port".to_string(),
        port,
    ];
    if json {
        args.push("--json".to_string());
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    delegate_provider_node(&refs)
}

fn delegate_provider_node(args: &[&str]) -> anyhow::Result<()> {
    let filtered: Vec<&str> = args.iter().copied().filter(|s| !s.is_empty()).collect();

    if let Some(program) = resolve_provider_node_program() {
        return finish_command(
            Command::new(&program)
                .args(&filtered)
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .status()?,
        );
    }

    if let Some(manifest) = dev_cargo_manifest_path() {
        eprintln!(
            "{}",
            "PROXYHUB_CLI_DEV: running provider-node via cargo (development only).".yellow()
        );
        let mut cargo = Command::new("cargo");
        cargo.arg("run").arg("--manifest-path").arg(manifest);
        if provider_transport_wants_quic() {
            cargo.arg("--features").arg("quic");
        }
        return finish_command(
            cargo
                .arg("--")
                .args(&filtered)
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .status()?,
        );
    }

    let status = Command::new(provider_node_binary_name())
        .args(&filtered)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|e| {
            anyhow::anyhow!(
                "Could not run provider-node ({e}). Download from dashboard or set PROXYHUB_PROVIDER_NODE."
            )
        })?;
    finish_command(status)
}

fn finish_command(status: std::process::ExitStatus) -> anyhow::Result<()> {
    if status.success() {
        Ok(())
    } else {
        anyhow::bail!("provider-node exited with {status}")
    }
}

#[derive(Deserialize)]
struct AuthResponse {
    valid: Option<bool>,
    #[allow(dead_code)]
    user_id: Option<String>,
    jwt_token: Option<String>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct RegisterResponse {
    id: String,
}

fn default_config_path() -> String {
    default_config_file().to_string_lossy().to_string()
}

fn default_config_file() -> PathBuf {
    let mut candidates = Vec::new();
    if let Some(dir) = dirs::config_dir() {
        candidates.push(dir.join("proxyhubb").join("provider.toml"));
    }
    if let Some(home) = dirs::home_dir() {
        let xdg = home.join(".config").join("proxyhubb").join("provider.toml");
        if !candidates.iter().any(|p| p == &xdg) {
            candidates.push(xdg);
        }
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

fn read_metrics_port(config_path: &Path) -> u16 {
    if let Ok(contents) = fs::read_to_string(config_path) {
        if let Ok(cfg) = toml::from_str::<ProviderConfig>(&contents) {
            return cfg.metrics_port;
        }
    }
    DEFAULT_METRICS_PORT
}

async fn handle_join(
    api_url: &str,
    api_key: &str,
    gateway: &str,
    existing_node_id: Option<&str>,
    output: Option<PathBuf>,
) -> anyhow::Result<()> {
    println!("{}", "🚀 Initializing ProxyHubb Provider...".bold().cyan());
    let pb = ProgressBar::new_spinner();
    pb.set_style(ProgressStyle::default_spinner().tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "));
    pb.enable_steady_tick(Duration::from_millis(100));

    let client = reqwest::Client::new();
    let api_url = api_url.trim_end_matches('/');

    pb.set_message("Authenticating with Control API...");
    let auth_url = format!("{api_url}/v1/provider/auth");
    let auth_resp = client
        .post(&auth_url)
        .json(&serde_json::json!({ "token": api_key }))
        .send()
        .await?;

    let status = auth_resp.status();
    let auth_body: AuthResponse = auth_resp.json().await?;
    if !status.is_success() || auth_body.valid == Some(false) {
        let msg = auth_body.message.unwrap_or_else(|| "auth failed".into());
        anyhow::bail!("Authentication failed: {msg}");
    }

    let jwt = auth_body
        .jwt_token
        .ok_or_else(|| anyhow::anyhow!("JWT missing in auth response"))?;

    let node_id = if let Some(id) = existing_node_id {
        pb.set_message("Using existing node...");
        id.to_string()
    } else {
        pb.set_message("Detecting public IP...");
        let public_ip = detect_public_ip().await.unwrap_or_else(|| "0.0.0.0".into());
        let node_name = format!("cli-node-{}", public_ip.replace('.', "-"));

        pb.set_message("Registering node...");
        let reg_url = format!("{api_url}/v1/provider/nodes");
        let resp = client
            .post(&reg_url)
            .header("Authorization", format!("Bearer {jwt}"))
            .json(&serde_json::json!({
                "name": node_name,
                "ip_address": if public_ip == "0.0.0.0" { "" } else { public_ip.as_str() },
            }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Node registration failed: {body}");
        }

        let reg: RegisterResponse = resp.json().await?;
        reg.id
    };

    let use_tls = gateway.contains("proxyhubb.com") || api_url.starts_with("https://");
    let config = ProviderConfig {
        control_api_url: api_url.to_string(),
        gateway_addr: gateway
            .trim_start_matches("http://")
            .trim_start_matches("https://")
            .to_string(),
        jwt_token: String::new(),
        api_key: api_key.to_string(),
        node_id,
        provider_signing_key: generate_provider_signing_key()?,
        connection_type: "residential".to_string(),
        use_tls,
        metrics_port: DEFAULT_METRICS_PORT,
    };

    let out_path = output.unwrap_or_else(default_config_file);
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let toml_str = toml::to_string(&config)?;
    fs::write(&out_path, &toml_str)?;

    pb.finish_with_message(format!(
        "✅ Provider enrolled (Node ID: {})",
        config.node_id
    ));
    println!("\n{}", "Connection package:".bold().white());
    println!(
        "  - Config file: {}",
        out_path.display().to_string().green()
    );
    println!(
        "  - Doctor: {}",
        format!("proxyhubb-cli doctor --config {}", out_path.display()).cyan()
    );
    println!(
        "  - Auth: {}",
        "api_key set; jwt_token left empty (daemon refreshes via /v1/provider/gateway-token)"
            .dimmed()
    );
    println!(
        "  - Start: {}",
        format!("proxyhubb-cli start --config {}", out_path.display())
            .cyan()
            .bold()
    );
    println!(
        "  - Dashboard: {}",
        format!("proxyhubb-cli dashboard --config {}", out_path.display()).cyan()
    );
    Ok(())
}

async fn detect_public_ip() -> Option<String> {
    let resp = reqwest::Client::new()
        .get("https://api.ipify.org?format=text")
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let ip = resp.text().await.ok()?.trim().to_string();
    if ip.is_empty() {
        None
    } else {
        Some(ip)
    }
}

fn generate_provider_signing_key() -> anyhow::Result<String> {
    let mut seed = [0_u8; 32];
    getrandom::getrandom(&mut seed)
        .map_err(|err| anyhow::anyhow!("failed to generate provider signing seed: {err}"))?;
    Ok(bs58::encode(seed).into_string())
}

fn provider_node_binary_name() -> &'static str {
    if cfg!(windows) {
        "provider-node.exe"
    } else {
        "provider-node"
    }
}

fn resolve_provider_node_program() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("PROXYHUB_PROVIDER_NODE") {
        let path = PathBuf::from(&custom);
        if path.is_file() {
            return Some(path);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sibling = dir.join(provider_node_binary_name());
            if sibling.is_file() {
                return Some(sibling);
            }
        }
    }

    None
}

fn dev_cargo_manifest_path() -> Option<PathBuf> {
    if std::env::var("PROXYHUB_CLI_DEV").is_err() {
        return None;
    }
    let candidates = [
        PathBuf::from("services/provider-node/Cargo.toml"),
        PathBuf::from("../services/provider-node/Cargo.toml"),
    ];
    candidates.into_iter().find(|path| path.is_file())
}

fn provider_transport_wants_quic() -> bool {
    matches!(
        std::env::var("PROVIDER_TRANSPORT")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "quic" | "http3"
    )
}

fn handle_start(config_file: &str) -> anyhow::Result<()> {
    println!("{}", "🚀 Starting provider-node...".bold().cyan());
    delegate_provider_node(&["start", "--config", config_file])
}

#[cfg(test)]
mod config_contract_tests {
    use super::*;

    #[test]
    fn join_config_serializes_required_provider_contract_fields() {
        let config = ProviderConfig {
            control_api_url: "https://api.proxyhubb.test".to_string(),
            gateway_addr: "gw.proxyhubb.test:3128".to_string(),
            jwt_token: String::new(),
            api_key: "provider-token-contract-test".to_string(),
            node_id: "node-contract-test".to_string(),
            provider_signing_key: "provider-signing-key-contract-test".to_string(),
            connection_type: "residential".to_string(),
            use_tls: true,
            metrics_port: DEFAULT_METRICS_PORT,
        };

        let body = toml::to_string(&config).unwrap();
        let parsed: toml::Value = toml::from_str(&body).unwrap();

        assert_eq!(
            parsed["control_api_url"].as_str(),
            Some("https://api.proxyhubb.test")
        );
        assert_eq!(
            parsed["gateway_addr"].as_str(),
            Some("gw.proxyhubb.test:3128")
        );
        assert_eq!(parsed["jwt_token"].as_str(), Some(""));
        assert_eq!(
            parsed["api_key"].as_str(),
            Some("provider-token-contract-test")
        );
        assert_eq!(parsed["node_id"].as_str(), Some("node-contract-test"));
        assert_eq!(
            parsed["provider_signing_key"].as_str(),
            Some("provider-signing-key-contract-test")
        );
        assert_eq!(parsed["connection_type"].as_str(), Some("residential"));
        assert_eq!(parsed["use_tls"].as_bool(), Some(true));
        assert_eq!(
            parsed["metrics_port"].as_integer(),
            Some(i64::from(DEFAULT_METRICS_PORT))
        );
    }
}
