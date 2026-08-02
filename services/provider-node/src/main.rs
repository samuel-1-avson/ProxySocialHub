mod config;
mod config_validate;
mod daemon_ctrl;
mod doctor;
mod install;
mod interactive;
mod ip;
mod lease_policy;
mod operator;
mod paths;
mod process_util;
mod proofs;
mod proxy;
mod runtime_state;
mod service;
mod stats;
mod status;
mod support;
mod sys;
mod tui;
mod tunnel;
mod watch;

use clap::{Parser, Subcommand};
use tracing::info;

/// ProxyHubb Provider Node — share your bandwidth and earn rewards.
///
/// Running with no subcommand opens an interactive console (useful when
/// double-clicking the Windows binary so a window stays open).
#[derive(Parser)]
#[command(name = "provider-node", version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
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

        /// Existing base58 Ed25519 provider signing key to write into provider.toml.
        /// If omitted, register generates a new key automatically.
        #[arg(long, env = "PROXYHUB_PROVIDER_SIGNING_KEY")]
        provider_signing_key: Option<String>,

        /// Do not auto-generate provider_signing_key during registration.
        #[arg(long, default_value_t = false)]
        no_generate_signing_key: bool,

        /// Write config to this path (default: platform config dir)
        #[arg(short, long)]
        config: Option<String>,
    },

    /// Generate a provider heartbeat signing key for provider.toml
    Keygen {
        /// Emit JSON for scripts
        #[arg(long)]
        json: bool,
    },

    /// Validate local provider-node configuration without network checks
    Config {
        #[command(subcommand)]
        command: ConfigCommands,
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

    /// Show local process, metrics, and Control API node registration state
    Status {
        /// Path to configuration file
        #[arg(short, long)]
        config: Option<String>,

        /// Metrics port override (default: from config or 9090)
        #[arg(long)]
        metrics_port: Option<u16>,

        /// Emit JSON for scripts
        #[arg(long)]
        json: bool,
    },

    /// Pre-flight checks for config, auth, gateway, and local daemon
    Doctor {
        /// Path to configuration file
        #[arg(short, long)]
        config: Option<String>,

        /// Emit JSON for scripts
        #[arg(long)]
        json: bool,
    },

    /// Interactive terminal dashboard (metrics + Control API nodes)
    Dashboard {
        /// Path to configuration file
        #[arg(short, long)]
        config: Option<String>,

        /// UI refresh interval in milliseconds
        #[arg(long, default_value_t = 1000)]
        refresh_ms: u64,
    },

    /// Refresh operator status in the terminal until Ctrl+C
    Watch {
        /// Path to configuration file
        #[arg(short, long)]
        config: Option<String>,

        /// Refresh interval in milliseconds
        #[arg(long, default_value_t = 2000)]
        interval_ms: u64,
    },

    /// Print canonical paths and install hints
    Install,

    /// Manage provider-node as an OS service
    Service {
        #[command(subcommand)]
        command: ServiceCommands,
    },

    /// Export redacted diagnostics for provider support
    Support {
        #[command(subcommand)]
        command: SupportCommands,
    },
}

#[derive(Subcommand)]
enum ConfigCommands {
    /// Validate provider.toml and print fixes for blocking issues
    Validate {
        /// Path to configuration file
        #[arg(short, long)]
        config: Option<String>,

        /// Emit JSON for scripts
        #[arg(long)]
        json: bool,
    },
}

#[derive(Subcommand)]
enum ServiceCommands {
    /// Install provider-node as a background service
    Install {
        /// Path to configuration file
        #[arg(short, long)]
        config: Option<String>,
    },
    /// Start the installed service
    Start,
    /// Stop the installed service
    Stop,
    /// Show service install/running status
    Status {
        /// Path to configuration file
        #[arg(short, long)]
        config: Option<String>,

        /// Emit JSON for scripts
        #[arg(long)]
        json: bool,
    },
    /// Uninstall the service
    Uninstall,
}

#[derive(Subcommand)]
enum SupportCommands {
    /// Write redacted config, doctor JSON, log tail, and runtime state to a JSON file
    Bundle {
        /// Path to configuration file
        #[arg(short, long)]
        config: Option<String>,

        /// Output JSON path (default: ~/.proxyhubb/support-bundle-<timestamp>.json)
        #[arg(short, long)]
        output: Option<String>,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    let Some(command) = cli.command else {
        return interactive::run().await;
    };

    match command {
        // ── Register ────────────────────────────────────────────────
        Commands::Register {
            api_url,
            api_key,
            connection_type,
            provider_signing_key,
            no_generate_signing_key,
            config,
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
            let cfg = config::Config {
                control_api_url: api_url.clone(),
                api_key: key.clone(),
                node_id: node_id.clone(),
                connection_type: connection_type.clone(),
                provider_signing_key: resolve_registration_signing_key(
                    provider_signing_key,
                    no_generate_signing_key,
                )?,
                ..config::Config::default()
            };

            let config_path = config
                .map(std::path::PathBuf::from)
                .unwrap_or_else(paths::config_file);
            cfg.save(&config_path)?;

            println!("Node ID: {node_id}");
            if !cfg.provider_signing_key.is_empty() {
                let signer = proofs::ProviderSigner::from_base58(&cfg.provider_signing_key)?;
                println!("Provider hotkey: {}", signer.public_key());
            }
            println!();
            println!("Config written to: {}", config_path.display());
            println!("Auth: api_key stored; jwt_token left empty (runtime refreshes gateway JWT).");
            println!();
            println!("Next steps:");
            println!("  provider-node start --config {}", config_path.display());
        }

        Commands::Keygen { json } => {
            init_logging(false);
            let generated = proofs::ProviderSigner::generate()?;
            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "provider_signing_key": generated.secret_base58,
                        "provider_hotkey": generated.public_key,
                    })
                );
            } else {
                println!("Provider signing key generated.");
                println!("provider_signing_key = \"{}\"", generated.secret_base58);
                println!("provider_hotkey = \"{}\"", generated.public_key);
                println!();
                println!("Add provider_signing_key to provider.toml to enable signed heartbeats.");
            }
        }

        Commands::Config {
            command: ConfigCommands::Validate { config, json },
        } => {
            init_logging(false);
            let config_path = config
                .map(std::path::PathBuf::from)
                .unwrap_or_else(config::Config::default_config_path);
            let report = config_validate::run(config_path);
            if json {
                println!("{}", serde_json::to_string_pretty(&report)?);
            } else {
                config_validate::print_human(&report);
            }
            if !report.ok {
                std::process::exit(1);
            }
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

            let config_path =
                config.unwrap_or_else(|| paths::config_file().to_string_lossy().into_owned());

            let _ = paths::ensure_state_dirs();
            let provider_run_id = runtime_state::new_provider_run_id();
            paths::append_log(&format!(
                "provider-node start run_id={} config={}",
                provider_run_id, config_path
            ));
            info!(provider_run_id = %provider_run_id, "Provider run started");

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
            // Only force TLS when the operator passed --use-tls; otherwise honor provider.toml.
            if use_tls {
                cfg.use_tls = true;
            }
            // Production-first: if the gateway is a public host or the control API is HTTPS,
            // default to TLS so `provider-node start` works without flags.
            if !cfg.use_tls && config::gateway_looks_public(&cfg.gateway_addr) {
                cfg.use_tls = true;
            }
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

            // PID file — refuse double-start; clear stale file from crashed runs.
            let pid_path = paths::pid_file();
            if let Some(live) = crate::process_util::read_pid_file()
                .filter(|&pid| crate::process_util::process_alive(pid))
            {
                eprintln!("Error: provider-node already running (PID {live}).");
                eprintln!("Stop it first: proxyhubb-cli stop");
                std::process::exit(1);
            }
            if let Some(stale) = crate::process_util::remove_stale_pid_file() {
                info!(stale_pid = stale, "Removed stale PID file before start");
                paths::append_log(&format!("removed stale pid file ({stale})"));
            }
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
            let transport_label = if transport.quic_requested() {
                "quic"
            } else {
                "yamux"
            };
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

                let rt = runtime_state::RuntimeState {
                    provider_run_id: provider_run_id.clone(),
                    active_gateway: addr.clone(),
                    gateway_index: gw_idx % gw_count,
                    gateway_total: gw_count,
                    transport: transport_label.to_string(),
                    tunnel_connected: false,
                    last_session_error: None,
                    updated_at_unix: runtime_state::unix_now(),
                };
                let _ = rt.write(&paths::runtime_state_file());
                paths::append_log(&format!(
                    "run_id={} connecting to gateway {addr}",
                    provider_run_id
                ));

                match tunnel::mux::run_mux_lanes(
                    loop_cfg,
                    stats_collector.clone(),
                    provider_signer.clone(),
                    lane_count,
                    provider_run_id.clone(),
                )
                .await
                {
                    Ok(()) => {
                        info!(addr = %addr, "Gateway session ended cleanly");
                    }
                    Err(e) => {
                        tracing::warn!(addr = %addr, error = %e, "Gateway session lost");
                        let msg = e.to_string();
                        paths::append_log(&format!(
                            "run_id={} gateway session lost {addr}: {msg}",
                            provider_run_id
                        ));
                        let rt = runtime_state::RuntimeState {
                            provider_run_id: provider_run_id.clone(),
                            active_gateway: addr.clone(),
                            gateway_index: gw_idx % gw_count,
                            gateway_total: gw_count,
                            transport: transport_label.to_string(),
                            tunnel_connected: false,
                            last_session_error: Some(msg),
                            updated_at_unix: runtime_state::unix_now(),
                        };
                        let _ = rt.write(&paths::runtime_state_file());
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

        // ── Status ──────────────────────────────────────────────────
        Commands::Status {
            config,
            metrics_port,
            json,
        } => {
            init_logging(false);
            let config_path = config
                .map(std::path::PathBuf::from)
                .unwrap_or_else(config::Config::default_config_path);
            let report = status::collect(config_path, metrics_port).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&report)?);
            } else {
                status::print_human(&report);
            }
        }

        Commands::Doctor { config, json } => {
            init_logging(false);
            let config_path = config
                .map(std::path::PathBuf::from)
                .unwrap_or_else(config::Config::default_config_path);
            let report = doctor::run(config_path).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&report)?);
            } else {
                doctor::print_human(&report);
            }
            if !report.ok {
                std::process::exit(1);
            }
        }

        Commands::Dashboard { config, refresh_ms } => {
            init_logging(false);
            let config_path = config
                .map(std::path::PathBuf::from)
                .unwrap_or_else(paths::config_file);
            match daemon_ctrl::ensure_running(&config_path).await {
                Ok(result) => info!("{}", daemon_ctrl::describe(result)),
                Err(e) => {
                    eprintln!("Warning: could not auto-start daemon: {e:#}");
                    eprintln!("Start it with: provider-node start --config {}", config_path.display());
                }
            }
            tui::dashboard::run(config_path, refresh_ms).await?;
        }

        Commands::Watch {
            config,
            interval_ms,
        } => {
            init_logging(false);
            let config_path = config
                .map(std::path::PathBuf::from)
                .unwrap_or_else(paths::config_file);
            watch::run(config_path, interval_ms).await?;
        }

        Commands::Install => {
            install::print_paths_and_hints();
        }

        Commands::Service { command } => match command {
            ServiceCommands::Install { config } => {
                let config_path = config.map(std::path::PathBuf::from);
                service::install(config_path)?;
            }
            ServiceCommands::Start => {
                service::start()?;
            }
            ServiceCommands::Stop => {
                service::stop()?;
            }
            ServiceCommands::Status { config, json } => {
                let config_path = config.map(std::path::PathBuf::from);
                let report = service::status(config_path);
                if json {
                    println!("{}", serde_json::to_string_pretty(&report)?);
                } else {
                    service::print_status(&report);
                }
            }
            ServiceCommands::Uninstall => {
                service::uninstall()?;
            }
        },

        Commands::Support {
            command: SupportCommands::Bundle { config, output },
        } => {
            init_logging(false);
            let config_path = config
                .map(std::path::PathBuf::from)
                .unwrap_or_else(config::Config::default_config_path);
            let output_path = output.map(std::path::PathBuf::from);
            let created = support::export(config_path, output_path).await?;
            support::print_created(&created);
        }

        // ── Stop ────────────────────────────────────────────────────
        Commands::Stop => {
            let pid_path = paths::pid_file();
            match std::fs::read_to_string(&pid_path) {
                Ok(pid_str) => {
                    let pid_trim = pid_str.trim();
                    let pid_num: u32 = pid_trim.parse().unwrap_or(0);
                    let alive = pid_num > 0 && crate::process_util::process_alive(pid_num);
                    if alive {
                        println!("Sending stop signal to PID {pid_trim}");
                    } else {
                        println!("Removing stale PID file (process {pid_trim} not running)");
                    }
                    // On Unix we'd send SIGTERM; on Windows we just inform the user.
                    #[cfg(unix)]
                    if alive {
                        {
                            use nix::sys::signal::{kill, Signal};
                            use nix::unistd::Pid;
                            let pid: i32 = pid_trim.parse()?;
                            kill(Pid::from_raw(pid), Signal::SIGTERM)?;
                            println!("Stop signal sent successfully.");
                        }
                    }
                    #[cfg(windows)]
                    if alive {
                        match std::process::Command::new("taskkill")
                            .args(["/PID", pid_trim, "/F"])
                            .output()
                        {
                            Ok(output) if output.status.success() => {
                                println!("Stop signal sent successfully.");
                            }
                            Ok(output) => {
                                let stderr = String::from_utf8_lossy(&output.stderr);
                                println!("Failed to stop process {pid_trim}: {}", stderr.trim());
                            }
                            Err(err) => {
                                println!("Failed to run taskkill for PID {pid_trim}: {err}");
                            }
                        }
                    }
                    #[cfg(all(not(unix), not(windows)))]
                    if alive {
                        println!(
                            "Please terminate the provider-node process manually (PID: {pid_trim})"
                        );
                    }
                    let _ = std::fs::remove_file(&pid_path);
                    if !alive {
                        println!("Stale PID file removed.");
                    }
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

fn write_pid_file(path: &std::path::Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, std::process::id().to_string())?;
    Ok(())
}

fn resolve_registration_signing_key(
    provider_signing_key: Option<String>,
    no_generate_signing_key: bool,
) -> anyhow::Result<String> {
    if let Some(key) = provider_signing_key {
        let key = key.trim().to_string();
        if key.is_empty() {
            return Ok(String::new());
        }
        proofs::ProviderSigner::from_base58(&key)?;
        return Ok(key);
    }

    if no_generate_signing_key {
        return Ok(String::new());
    }

    Ok(proofs::ProviderSigner::generate()?.secret_base58)
}
