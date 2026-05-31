use clap::{Parser, Subcommand};
use colored::*;
use indicatif::{ProgressBar, ProgressStyle};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

#[derive(Parser)]
#[command(name = "proxyhubb-cli")]
#[command(about = "ProxyHubb Provider Command Center", long_about = None)]
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
    /// Start the provider node daemon
    Start {
        /// Path to configuration file
        #[arg(short, long)]
        config: Option<PathBuf>,
    },
    /// Check your provider status and earnings
    Status,
}

#[derive(Debug, Serialize, Deserialize)]
struct ProviderConfig {
    control_api_url: String,
    gateway_addr: String,
    jwt_token: String,
    api_key: String,
    node_id: String,
    connection_type: String,
    use_tls: bool,
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
            handle_start(&path);
        }
        Commands::Status => {
            if let Err(e) = handle_status().await {
                eprintln!("{} {}", "Failed to retrieve status:".red().bold(), e);
            }
        }
    }
}

#[derive(Deserialize)]
struct AuthResponse {
    valid: Option<bool>,
    user_id: Option<String>,
    jwt_token: Option<String>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct RegisterResponse {
    id: String,
}

fn default_config_path() -> String {
    default_config_file()
        .to_string_lossy()
        .to_string()
}

fn default_config_file() -> PathBuf {
    if let Some(dir) = dirs::config_dir() {
        return dir.join("proxyhubb").join("provider.toml");
    }
    PathBuf::from("provider.toml")
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
        gateway_addr: gateway.trim_start_matches("http://").trim_start_matches("https://").to_string(),
        jwt_token: String::new(),
        api_key: api_key.to_string(),
        node_id,
        connection_type: "residential".to_string(),
        use_tls,
    };

    let out_path = output.unwrap_or_else(default_config_file);
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let toml_str = toml::to_string(&config)?;
    fs::write(&out_path, &toml_str)?;

    pb.finish_with_message(format!("✅ Provider enrolled (Node ID: {})", config.node_id));
    println!("\n{}", "Connection package:".bold().white());
    println!("  - Config file: {}", out_path.display().to_string().green());
    println!(
        "  - Start: {}",
        format!(
            "provider-node start --config {}",
            out_path.display()
        )
        .cyan()
        .bold()
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

fn handle_start(config_file: &str) {
    println!("{}", "🚀 Starting ProxyHubb Node Daemon...".bold().cyan());

    let mut child = Command::new("cargo")
        .args([
            "run",
            "--manifest-path",
            "../services/provider-node/Cargo.toml",
            "--",
            "start",
            "--config",
            config_file,
        ])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("Failed to start provider node via cargo");

    let status = child.wait().expect("Failed to wait on child");
    println!("Node exited with: {status}");
}

#[derive(Deserialize)]
struct NodeStats {
    active_connections: u32,
    total_connections: u64,
    bytes_up: u64,
    bytes_down: u64,
    uptime_seconds: u64,
    latency_ms: u32,
    connection_type: String,
}

async fn handle_status() -> anyhow::Result<()> {
    println!("{}", "📊 Provider Status Overview".bold().cyan());
    println!("----------------------------------");

    let client = reqwest::Client::new();
    match client.get("http://localhost:9091/stats").send().await {
        Ok(resp) => {
            let stats: NodeStats = resp.json().await?;
            println!(
                "  - Active Connections: {}",
                stats.active_connections.to_string().white()
            );
            println!(
                "  - Total Processed:    {}",
                stats.total_connections.to_string().white()
            );
            println!(
                "  - Bandwidth (Up):     {} MB",
                (stats.bytes_up / 1_000_000).to_string().yellow()
            );
            println!(
                "  - Bandwidth (Down):   {} MB",
                (stats.bytes_down / 1_000_000).to_string().yellow()
            );
            println!(
                "  - Gateway Latency:    {} ms",
                stats.latency_ms.to_string().green()
            );
            println!(
                "  - Network Type:       {}",
                stats.connection_type.cyan()
            );
            println!("  - Uptime:             {} seconds", stats.uptime_seconds);
        }
        Err(_) => {
            println!(
                "  {}",
                "Node is currently offline (could not reach local stats server).".red()
            );
        }
    }
    println!("----------------------------------");
    Ok(())
}
