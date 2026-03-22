use clap::{Parser, Subcommand};
use colored::*;
use indicatif::{ProgressBar, ProgressStyle};
use serde::{Deserialize, Serialize};
use std::fs;
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
    /// Join the ProxyHubb network as a provider
    Join {
        /// Control API URL
        #[arg(short, long, default_value = "http://localhost:8080")]
        api_url: String,

        /// Provider API key
        #[arg(short, long)]
        key: String,
        
        /// Gateway address
        #[arg(short, long, default_value = "localhost:3128")]
        gateway: String,
    },
    /// Start the provider node daemon
    Start {
        /// Path to configuration file
        #[arg(short, long, default_value = "provider.toml")]
        config: String,
    },
    /// Check your provider status and earnings
    Status,
}

// Config that mirrors the internal provider-node Config
#[derive(Debug, Serialize, Deserialize)]
struct ProviderConfig {
    gateway_addr: String,
    jwt_token: String,
    api_key: String,
    node_id: String,
    connection_type: String,
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    
    match cli.command {
        Commands::Join { api_url, key, gateway } => {
            if let Err(e) = handle_join(&api_url, &key, &gateway).await {
                eprintln!("{} {}", "Registration failed:".red().bold(), e);
            }
        }
        Commands::Start { config } => {
            handle_start(&config);
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
    user_id: Option<String>,
    jwt_token: Option<String>,
}

#[derive(Deserialize)]
struct RegisterResponse {
    #[serde(alias = "existing_node_id")]
    id: String,
}

async fn handle_join(api_url: &str, api_key: &str, gateway: &str) -> anyhow::Result<()> {
    println!("{}", "🚀 Initializing ProxyHubb Provider...".bold().cyan());
    let pb = ProgressBar::new_spinner();
    pb.set_style(ProgressStyle::default_spinner().tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "));
    pb.enable_steady_tick(Duration::from_millis(100));
    
    pb.set_message("Authenticating with Control API...");
    let client = reqwest::Client::new();
    
    let auth_url = format!("{}/v1/provider/auth", api_url);
    let auth_resp: AuthResponse = client.post(&auth_url)
        .json(&serde_json::json!({ "token": api_key }))
        .send()
        .await?
        .json()
        .await?;

    let jwt = auth_resp.jwt_token.expect("JWT token missing in auth response");
    
    pb.set_message("Detecting Public IP...");
    // Mock public IP for demo since we're local
    let public_ip = "127.0.0.1".to_string(); 
    let node_name = "cli-node-01".to_string();

    pb.set_message("Registering node...");
    let reg_url = format!("{}/v1/provider/nodes", api_url);
    let resp = client.post(&reg_url)
        .header("Authorization", format!("Bearer {}", jwt))
        .json(&serde_json::json!({
            "name": node_name,
            "ip_address": public_ip
        }))
        .send()
        .await?;

    let resp_body = resp.text().await?;
    // println!("DEBUG: Registration response: {}", resp_body);
    
    let reg_resp: RegisterResponse = serde_json::from_str(&resp_body)
        .map_err(|e| anyhow::anyhow!("Failed to decode response: {}. Body: {}", e, resp_body))?;
        
    let config = ProviderConfig {
        gateway_addr: gateway.to_string(),
        jwt_token: jwt,
        api_key: api_key.to_string(),
        node_id: reg_resp.id.clone(),
        connection_type: "fiber".to_string(),
    };
    
    let toml_str = toml::to_string(&config)?;
    fs::write("provider.toml", toml_str)?;

    pb.finish_with_message(format!("✅ Provider Enrolled (Node ID: {})", reg_resp.id));
    println!("\n{}", "Registration Details:".bold().white());
    println!("  - Node ID: {}", reg_resp.id);
    println!("  - IP Address: {}", public_ip);
    println!("  - Config: {}", "provider.toml saved.".green());
    println!("\nRun {} to begin sharing bandwidth.", "proxyhubb-cli start".cyan().bold());
    Ok(())
}

fn handle_start(config_file: &str) {
    println!("{}", "🚀 Starting ProxyHubb Node Daemon...".bold().cyan());
    
    // Attempt to run via cargo for local dev if provider-node isn't mapped
    let mut child = Command::new("cargo")
        .args(&["run", "--manifest-path", "../services/provider-node/Cargo.toml", "--", "start", "--config", config_file])
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
            println!("  - Active Connections: {}", stats.active_connections.to_string().white());
            println!("  - Total Processed:    {}", stats.total_connections.to_string().white());
            println!("  - Bandwidth (Up):     {} MB", (stats.bytes_up / 1_000_000).to_string().yellow());
            println!("  - Bandwidth (Down):   {} MB", (stats.bytes_down / 1_000_000).to_string().yellow());
            println!("  - Gateway Latency:    {} ms", stats.latency_ms.to_string().green());
            println!("  - Network Type:       {}", stats.connection_type.cyan());
            println!("  - Uptime:             {} seconds", stats.uptime_seconds);
        }
        Err(_) => {
            println!("  {}", "Node is currently offline (could not reach local stats server).".red());
        }
    }
    println!("----------------------------------");
    Ok(())
}
