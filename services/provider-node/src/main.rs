mod config;
mod ip;
mod lease_policy;
mod proofs;
mod proxy;
mod stats;
mod sys;
mod tunnel;

use clap::{Parser, Subcommand};
use tracing::info;

/// ProxyHubb Provider Node — share your bandwidth and earn rewards.
#[derive(Parser)]
#[command(name = "provider-node", version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Register a new provider node with the Control API
    Register {
        /// Control API URL
        #[arg(
            long,
            env = "PROXYHUB_API_URL",
            default_value = "http://localhost:18080"
        )]
        api_url: String,

        /// Provider API key / token
        #[arg(long, env = "PROXYHUB_API_KEY")]
        api_key: Option<String>,

        /// Declared connection type for initial node registration.
        #[arg(long, env = "PROXYHUB_CONNECTION_TYPE", default_value = "residential")]
        connection_type: String,
    },

    /// Connect to the Edge Gateway and start serving proxy traffic
    Start {
        /// Path to configuration file (default: ~/.config/proxyhubb/provider.toml or %USERPROFILE%\\.proxyhubb\\provider.toml)
        #[arg(short, long)]
        config: Option<String>,

        /// Control API URL used for auth bootstrap and provider lease issuance
        #[arg(long, env = "PROXYHUB_API_URL")]
        api_url: Option<String>,

        /// Primary Edge Gateway address (host:port)
        #[arg(long, env = "PROXYHUB_GATEWAY_ADDR")]
        gateway_addr: Option<String>,

        /// Comma-separated list of gateway addresses for multi-gateway failover.
        /// e.g. "gw1.proxyhubb.io:3128,gw2.proxyhubb.io:3128"
        /// The node cycles through all addresses on reconnect.
        #[arg(long, env = "PROXYHUB_GATEWAY_ADDRS", value_delimiter = ',')]
        gateway_addrs: Option<Vec<String>>,

        /// JWT token for authentication
        #[arg(long, env = "PROXYHUB_JWT_TOKEN")]
        jwt_token: Option<String>,

        /// Provider API key (overrides config file when set)
        #[arg(long, env = "PROXYHUB_API_KEY")]
        api_key: Option<String>,

        /// Base58 Ed25519 provider signing key used for heartbeat proofs
        #[arg(long, env = "PROXYHUB_PROVIDER_SIGNING_KEY")]
        provider_signing_key: Option<String>,

        /// Enable TLS for the tunnel connection
        #[arg(long, default_value_t = false)]
        use_tls: bool,

        /// Enable debug logging
        #[arg(long, default_value_t = false)]
        debug: bool,

        /// Parallel yamux tunnels per gateway (P4; env `YAMUX_CONNS_PER_NODE`, max 16).
        #[arg(long, env = "YAMUX_CONNS_PER_NODE")]
        yamux_conns_per_node: Option<usize>,
    },

    /// Display real-time node metrics from a running node
    Metrics {
        /// Port of the local stats server
        #[arg(long, default_value_t = 9090)]
        port: u16,
    },

    /// Stop a running provider node
    Stop,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        // ── Register ────────────────────────────────────────────────
        Commands::Register {
            api_url,
            api_key,
            connection_type,
        } => {
            init_logging(false);
            info!("Starting interactive node registration");

            let public_ip = ip::detect_public_ip().await.unwrap_or_default();
            if !public_ip.is_empty() {
                println!("✓ Detected public IP: {public_ip}");
            } else {
                println!("⚠ Could not auto-detect IP. You'll need to enter it manually.");
            }

            let key = api_key.unwrap_or_else(|| {
                eprintln!("Error: --api-key or PROXYHUB_API_KEY is required for registration.");
                std::process::exit(1);
            });

            // Authenticate
            println!("Authenticating with Control API...");
            let (user_id, jwt) = ip::validate_api_key(&api_url, &key).await?;
            println!("✓ Authenticated as user: {user_id}");

            // Register node
            let node_name = format!("rust-node-{}", public_ip.replace('.', "-"));
            let node_id =
                ip::register_node(&api_url, &jwt, &node_name, &public_ip, &connection_type).await?;

            println!();
            println!("╔══════════════════════════════════════════════════════════╗");
            println!("║              ✓ NODE REGISTERED SUCCESSFULLY              ║");
            println!("╚══════════════════════════════════════════════════════════╝");
            println!();
            let mut cfg = config::Config::default();
            cfg.control_api_url = api_url.clone();
            cfg.api_key = key.clone();
            cfg.node_id = node_id.clone();
            cfg.connection_type = connection_type.clone();

            let config_path = config::Config::default_config_path();
            cfg.save(&config_path)?;

            println!("Node ID: {node_id}");
            println!();
            println!("Config written to: {}", config_path.display());
            println!();
            println!("Next steps:");
            println!("  provider-node start --config {}", config_path.display());
        }

        // ── Start ───────────────────────────────────────────────────
        Commands::Start {
            config,
            api_url,
            gateway_addr,
            gateway_addrs,
            jwt_token,
            api_key,
            provider_signing_key,
            use_tls,
            debug,
            yamux_conns_per_node,
        } => {
            init_logging(debug);
            info!(
                "Starting ProxyHubb Provider Node v{}",
                env!("CARGO_PKG_VERSION")
            );

            let config_path = config.unwrap_or_else(|| {
                config::Config::default_config_path()
                    .to_string_lossy()
                    .into_owned()
            });

            let mut cfg = config::Config::load(&config_path).unwrap_or_default();

            if let Some(url) = api_url {
                cfg.control_api_url = url;
            }

            // CLI overrides
            if let Some(addr) = gateway_addr {
                cfg.gateway_addr = addr;
            }
            if let Some(addrs) = gateway_addrs {
                cfg.gateway_addrs = addrs;
            }
            if let Some(token) = jwt_token {
                cfg.jwt_token = token;
            }
            if let Some(key) = api_key {
                cfg.api_key = key;
            }
            if let Some(key) = provider_signing_key {
                cfg.provider_signing_key = key;
            }
            cfg.use_tls = use_tls;
            if let Some(lanes) = yamux_conns_per_node {
                cfg.yamux_conns_per_node = tunnel::mux::normalize_lane_count(lanes);
            } else if let Some(lanes) = config::yamux_conns_per_node_from_env() {
                cfg.yamux_conns_per_node = lanes;
            }

            if cfg.jwt_token.is_empty() && cfg.api_key.is_empty() {
                eprintln!("Error: JWT token or API key is required.");
                eprintln!("Set via config api_key, --api-key, PROXYHUB_API_KEY, or --jwt-token / PROXYHUB_JWT_TOKEN.");
                std::process::exit(1);
            }

            // Build the ordered gateway list — primary addr is always first.
            // Deduplicate while preserving order.
            let mut gateway_list: Vec<String> = Vec::new();
            if !cfg.gateway_addr.is_empty() {
                gateway_list.push(cfg.gateway_addr.clone());
            }
            for addr in &cfg.gateway_addrs {
                if !gateway_list.contains(addr) {
                    gateway_list.push(addr.clone());
                }
            }
            if gateway_list.is_empty() {
                gateway_list.push("localhost:3128".to_string());
            }
            info!(gateways = ?gateway_list, "Multi-gateway failover list built");

            // Write PID file
            let pid_path = dirs_pid_file();
            if let Err(e) = write_pid_file(&pid_path) {
                tracing::warn!("Failed to write PID file: {e}");
            }

            // Stats collector
            let stats_collector = stats::Collector::new();
            stats_collector.set_connection_type(cfg.connection_type.clone());

            let provider_signer = if cfg.provider_signing_key.trim().is_empty() {
                None
            } else {
                let signer = proofs::ProviderSigner::from_base58(&cfg.provider_signing_key)?;
                info!(
                    provider_hotkey = %signer.public_key(),
                    "Provider heartbeat signing enabled"
                );
                Some(signer)
            };

            // Local stats HTTP server
            if cfg.metrics_enabled {
                let collector_clone = stats_collector.clone();
                let port = cfg.metrics_port;
                tokio::spawn(async move {
                    stats::serve_metrics(collector_clone, port).await;
                });
                info!(port = cfg.metrics_port, "Stats server started");
            }

            // Multi-gateway reconnect loop:
            // On each failure the index advances to the next gateway so the
            // node automatically migrates away from a dead endpoint.
            let reconnect_interval = cfg.reconnect_interval;
            let transport = config::ProviderTransport::from_env();
            if transport.quic_requested() {
                if !cfg.use_tls {
                    info!("PROVIDER_TRANSPORT=quic: enabling TLS for gateway QUIC tunnel");
                    cfg.use_tls = true;
                }
                info!(
                    transport = "quic",
                    gateway = %cfg.gateway_addr,
                    "Provider transport: QUIC (UDP) + yamux on first bidi stream"
                );
            }

            let lane_count = cfg.effective_yamux_conns_per_node();
            let gw_count = gateway_list.len();
            let mut gw_idx: usize = 0;
            info!(
                yamux_conns_per_node = lane_count,
                "Provider transport: multi-yamux lanes to gateway"
            );

            loop {
                let addr = gateway_list[gw_idx % gw_count].clone();
                let mut loop_cfg = cfg.clone();
                loop_cfg.gateway_addr = addr.clone();

                info!(
                    addr = %addr,
                    gateway_index = gw_idx % gw_count,
                    lanes = lane_count,
                    "Connecting to Edge Gateway..."
                );

                match tunnel::mux::run_mux_lanes(
                    loop_cfg,
                    stats_collector.clone(),
                    provider_signer.clone(),
                    lane_count,
                )
                .await
                {
                    Ok(()) => {
                        info!(addr = %addr, "Gateway session ended cleanly");
                    }
                    Err(e) => {
                        tracing::warn!(addr = %addr, error = %e, "Gateway session lost");
                    }
                }

                gw_idx += 1;
                tokio::time::sleep(reconnect_interval).await;
                info!(
                    next_gateway = %gateway_list[gw_idx % gw_count],
                    "Rotating to next gateway..."
                );
            }
        }

        // ── Metrics ─────────────────────────────────────────────────
        Commands::Metrics { port } => {
            init_logging(false);
            let url = format!("http://localhost:{port}/stats");
            match reqwest::get(&url).await {
                Ok(resp) => {
                    let snap: stats::Snapshot = resp.json().await?;
                    println!("--- Node Metrics ---");
                    println!("Uptime:              {}s", snap.uptime_seconds);
                    println!("Active Connections:  {}", snap.active_connections);
                    println!("Total Connections:   {}", snap.total_connections);
                    println!("Upload:              {} bytes", snap.bytes_up);
                    println!("Download:            {} bytes", snap.bytes_down);
                    println!("Rate Up:             {} Kbps", snap.rate_up_kbps);
                    println!("Rate Down:           {} Kbps", snap.rate_down_kbps);
                    println!("Latency (Gateway):   {} ms", snap.latency_ms);
                    println!("Connection Type:     {}", snap.connection_type);
                }
                Err(_) => {
                    println!("Node is not running (cannot reach stats server at {url})");
                    println!("Start your node with: provider-node start");
                }
            }
        }

        // ── Stop ────────────────────────────────────────────────────
        Commands::Stop => {
            let pid_path = dirs_pid_file();
            match std::fs::read_to_string(&pid_path) {
                Ok(pid_str) => {
                    println!("Sending stop signal to PID {}", pid_str.trim());
                    // On Unix we'd send SIGTERM; on Windows we just inform the user.
                    #[cfg(unix)]
                    {
                        use nix::sys::signal::{kill, Signal};
                        use nix::unistd::Pid;
                        let pid: i32 = pid_str.trim().parse()?;
                        kill(Pid::from_raw(pid), Signal::SIGTERM)?;
                        println!("Stop signal sent successfully.");
                    }
                    #[cfg(not(unix))]
                    {
                        println!(
                            "On Windows, please terminate the process manually (PID: {})",
                            pid_str.trim()
                        );
                    }
                    let _ = std::fs::remove_file(&pid_path);
                }
                Err(_) => {
                    println!("No running node found (PID file not found).");
                }
            }
        }
    }

    Ok(())
}

// ── Helpers ─────────────────────────────────────────────────────────

fn init_logging(debug: bool) {
    use tracing_subscriber::EnvFilter;
    let filter = if debug {
        EnvFilter::new("debug")
    } else {
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))
    };
    tracing_subscriber::fmt().with_env_filter(filter).init();
}

fn dirs_pid_file() -> std::path::PathBuf {
    let home = dirs_home();
    home.join(".proxyhubb").join("provider.pid")
}

fn dirs_home() -> std::path::PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}

fn write_pid_file(path: &std::path::Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, std::process::id().to_string())?;
    Ok(())
}
