mod config;
mod config_validate;
mod daemon_ctrl;
mod doctor;
mod install;
mod interactive;
mod ip;
mod lease_policy;
mod operator;
mod pair;
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
mod update;
mod watch;

use anyhow::Context;
use clap::{Parser, Subcommand};
use tracing::{info, warn};

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

    /// Write a ready-to-run provider.toml for an existing dashboard node (no hand-editing)
    Join {
        /// Provider API key / token from Dashboard Connect
        #[arg(long, env = "PROXYHUB_API_KEY")]
        api_key: Option<String>,

        /// Provider node UUID from the dashboard (auto-generated if omitted)
        #[arg(long)]
        node_id: Option<String>,

        /// Run interactive setup wizard
        #[arg(long, short = 'i', default_value_t = false)]
        interactive: bool,

        /// Control API URL
        #[arg(
            long,
            env = "PROXYHUB_API_URL",
            default_value = "https://api.proxyhubb.com"
        )]
        api_url: String,

        /// Primary Edge Gateway address (host:port)
        #[arg(
            long,
            env = "PROXYHUB_GATEWAY_ADDR",
            default_value = "proxy.proxyhubb.com:3128"
        )]
        gateway_addr: String,

        /// Overwrite an existing provider.toml
        #[arg(long, default_value_t = false)]
        force: bool,

        /// Write config to this path (default: platform config dir)
        #[arg(short, long)]
        config: Option<String>,
    },

    /// Connect this computer to your account: show a code, approve it in the dashboard
    Pair {
        /// Control API URL
        #[arg(
            long,
            env = "PROXYHUB_API_URL",
            default_value = "https://api.proxyhubb.com"
        )]
        api_url: String,

        /// Primary Edge Gateway address (host:port)
        #[arg(
            long,
            env = "PROXYHUB_GATEWAY_ADDR",
            default_value = "proxy.proxyhubb.com:3128"
        )]
        gateway_addr: String,

        /// Name shown on the approval page (default: this computer's name)
        #[arg(long)]
        device_name: Option<String>,

        /// Print the code and link instead of opening a browser
        #[arg(long, default_value_t = false)]
        no_browser: bool,

        /// Machine-readable output: one JSON event per line (code, approved, denied,
        /// expired, error) and nothing else. Never opens a browser. For programs driving
        /// this command, such as the desktop app.
        #[arg(long, default_value_t = false)]
        json: bool,

        /// Overwrite an existing provider.toml
        #[arg(long, default_value_t = false)]
        force: bool,

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
        /// Path to configuration file (default: ~/.config/proxyhubb/provider.toml or %APPDATA%\\proxyhubb\\provider.toml)
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

        /// Start the tunnel as a detached background process and return. Used by the
        /// sign-in entry that `service install` creates; the background daemon reads
        /// only `provider.toml`, so the other overrides above do not apply.
        #[arg(long, default_value_t = false)]
        background: bool,
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

        /// Only look at this computer (process, local metrics, tunnel state); do not call the
        /// Control API. Fast and offline-safe, for programs that poll every few seconds.
        #[arg(long)]
        local: bool,
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

    /// Check for / install the latest provider-node release in place
    Update {
        /// Only report whether an update is available
        #[arg(long)]
        check: bool,

        /// Skip the confirmation prompt
        #[arg(long, short = 'y')]
        yes: bool,
    },

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
    /// Install a provider.toml into the canonical operator path (stdin or --from file)
    Install {
        /// Path to a TOML file, or "-" to read stdin
        #[arg(long, short = 'f', default_value = "-")]
        from: String,

        /// Overwrite an existing provider.toml
        #[arg(long, default_value_t = false)]
        force: bool,

        /// Skip the confirmation prompt shown when run from a terminal
        #[arg(long, short = 'y', default_value_t = false)]
        yes: bool,

        /// Destination path (default: platform config dir)
        #[arg(short, long)]
        config: Option<String>,
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
    Start {
        /// Path to configuration file (Windows only; defaults to the platform config dir)
        #[arg(short, long)]
        config: Option<String>,
    },
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

        Commands::Join {
            api_key,
            node_id,
            interactive: _,
            api_url,
            gateway_addr,
            force,
            config,
        } => {
            init_logging(false);
            let api_key = match api_key {
                Some(k) if !k.trim().is_empty() => k.trim().to_string(),
                _ => {
                    print!("  ? Enter your Provider API Key: ");
                    let _ = std::io::Write::flush(&mut std::io::stdout());
                    let mut line = String::new();
                    std::io::stdin().read_line(&mut line)?;
                    let key = line.trim().to_string();
                    if key.is_empty() {
                        anyhow::bail!("Provider API key cannot be empty");
                    }
                    key
                }
            };

            let node_id = match node_id {
                Some(id) if !id.trim().is_empty() => id.trim().to_string(),
                _ => {
                    print!("  ? Enter Node ID (press Enter for auto-generated UUID): ");
                    let _ = std::io::Write::flush(&mut std::io::stdout());
                    let mut line = String::new();
                    std::io::stdin().read_line(&mut line)?;
                    let id = line.trim().to_string();
                    if id.is_empty() {
                        format!("node-{}", uuid::Uuid::new_v4())
                    } else {
                        id
                    }
                }
            };

            println!("Joining existing dashboard node…");
            install_provider_config(
                &api_url,
                &gateway_addr,
                &api_key,
                &node_id,
                config,
                force,
                true,
            )
            .await?;
        }

        Commands::Pair {
            api_url,
            gateway_addr,
            device_name,
            no_browser,
            json,
            force,
            config,
        } => {
            if json {
                // No logging init: tracing output must not interleave with the event lines.
                return run_pair_json(api_url, gateway_addr, device_name, force, config).await;
            }
            init_logging(false);
            // Check before asking anyone to approve anything: a pairing mints a token
            // and a node, so failing on an existing config afterwards would waste both.
            let config_path = config
                .clone()
                .map(std::path::PathBuf::from)
                .unwrap_or_else(paths::config_file);
            refuse_if_config_exists(&config_path, force);

            let granted = pair::run(&api_url, device_name, !no_browser).await?;
            // The key is shown exactly once, so write it before anything else can fail.
            // Pairing just minted it, so the check `join` does for typed-in keys is skipped.
            install_provider_config(
                &api_url,
                &gateway_addr,
                &granted.api_key,
                &granted.node_id,
                config,
                force,
                false,
            )
            .await?;
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

        Commands::Config {
            command:
                ConfigCommands::Install {
                    from,
                    force,
                    yes,
                    config,
                },
        } => {
            init_logging(false);
            let contents = if from == "-" {
                use std::io::Read;
                let mut buf = String::new();
                std::io::stdin()
                    .read_to_string(&mut buf)
                    .context("Failed to read provider.toml from stdin")?;
                buf
            } else {
                std::fs::read_to_string(&from).with_context(|| format!("Failed to read {from}"))?
            };
            // Parse to validate before writing.
            let parsed: config::Config =
                toml::from_str(&contents).context("Invalid provider.toml contents")?;
            let config_path = config
                .map(std::path::PathBuf::from)
                .unwrap_or_else(paths::config_file);
            if config_path.exists() && !force {
                eprintln!(
                    "Config already exists at {}. Re-run with --force to overwrite.",
                    config_path.display()
                );
                std::process::exit(1);
            }
            // DP-CRIT-03: importing a config is an explicit, visible step. Show where it
            // sends traffic and ask first when a person is at the terminal. Piped input
            // (`--from -`) has no one to ask, so that path proceeds as before.
            println!("Config to install → {}", config_path.display());
            print!("{}", parsed.install_summary());
            {
                use std::io::{IsTerminal, Write};
                if !yes && std::io::stdin().is_terminal() {
                    print!("Install this config? [y/N] ");
                    std::io::stdout().flush()?;
                    let mut answer = String::new();
                    std::io::stdin().read_line(&mut answer)?;
                    if !matches!(answer.trim().to_ascii_lowercase().as_str(), "y" | "yes") {
                        eprintln!("Aborted. Nothing was written.");
                        std::process::exit(1);
                    }
                }
            }
            config::write_private(&config_path, &contents)?;
            println!("Installed provider.toml → {}", config_path.display());
            println!("Next: provider-node start");
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
            background,
        } => {
            if background {
                let config_path = config
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(paths::config_file);
                let result = daemon_ctrl::ensure_started(&config_path).await?;
                println!("{}", daemon_ctrl::describe(result));
                return Ok(());
            }
            init_logging(debug);
            info!(
                "Starting ProxyHubb Provider Node v{}",
                env!("CARGO_PKG_VERSION")
            );

            let config_path =
                config.unwrap_or_else(|| paths::config_file().to_string_lossy().into_owned());
            // DP-CRIT-03: never pick up a config file from ~/Downloads on start. A file a
            // browser dropped there could redirect the gateway and disable TLS checks;
            // use `provider-node config install --from <file>` to import one on purpose.

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
            // Raw IP + TLS cannot present a hostname matching Let's Encrypt — skip verify
            // only in that case (prefer gateway_addr = proxy.proxyhubb.com:3128).
            if cfg.use_tls && !cfg.tls_skip_verify {
                let host = cfg
                    .gateway_addr
                    .split(':')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if host.parse::<std::net::Ipv4Addr>().is_ok()
                    || host.parse::<std::net::Ipv6Addr>().is_ok()
                {
                    warn!(
                        gateway = %cfg.gateway_addr,
                        "gateway_addr is a raw IP with TLS; enabling tls_skip_verify. Prefer hostname proxy.proxyhubb.com:3128"
                    );
                    cfg.tls_skip_verify = true;
                }
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
                .filter(|&pid| crate::process_util::provider_process_alive(pid))
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

            // Stats collector, seeded with the previous run's lifetime totals so
            // dashboard counters survive restarts.
            let stats_collector = stats::Collector::new();
            stats_collector.set_connection_type(cfg.connection_type.clone());
            let seeded = stats::Collector::load_totals(&paths::stats_file());
            stats_collector.seed_totals(&seeded);

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

                let session_ok = match tunnel::mux::run_mux_lanes(
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
                        true
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
                            last_session_error: Some(msg.clone()),
                            updated_at_unix: runtime_state::unix_now(),
                        };
                        let _ = rt.write(&paths::runtime_state_file());

                        if is_fatal_provider_auth_error(&msg) {
                            tracing::error!(
                                error = %msg,
                                "Fatal provider auth failure — stopping reconnect loop"
                            );
                            eprintln!();
                            eprintln!("FATAL: {msg}");
                            eprintln!(
                                "Fix: Dashboard → Provider → My nodes → Connect → paste the Windows install script,"
                            );
                            eprintln!(
                                "or: provider-node join --force --api-key <fresh_token> --node-id {}",
                                cfg.node_id
                            );
                            eprintln!("Then: provider-node stop && provider-node start");
                            return Err(e);
                        }
                        false
                    }
                };

                gw_idx = next_gateway_index(gw_idx, gw_count, session_ok);
                tokio::time::sleep(reconnect_interval).await;
                if session_ok {
                    info!(
                        next_gateway = %gateway_list[gw_idx],
                        "Session ended; retrying primary gateway..."
                    );
                } else {
                    info!(
                        next_gateway = %gateway_list[gw_idx],
                        "Rotating to next gateway..."
                    );
                }
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
            local,
        } => {
            // With --json, stdout must be the report and nothing else; logging goes to stdout.
            if !json {
                init_logging(false);
            }
            let config_path = config
                .map(std::path::PathBuf::from)
                .unwrap_or_else(config::Config::default_config_path);
            let mode = if local {
                status::StatusCollectMode::LocalOnly
            } else {
                status::StatusCollectMode::Full
            };
            let report = status::collect_with_mode(config_path, metrics_port, mode).await?;
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
                    eprintln!(
                        "Start it with: provider-node start --config {}",
                        config_path.display()
                    );
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

        Commands::Update { check, yes } => {
            init_logging(false);
            update::run(check, yes).await?;
        }

        Commands::Service { command } => match command {
            ServiceCommands::Install { config } => {
                let config_path = config.map(std::path::PathBuf::from);
                service::install(config_path)?;
            }
            ServiceCommands::Start { config } => {
                let config_path = config.map(std::path::PathBuf::from);
                service::start(config_path).await?;
            }
            ServiceCommands::Stop => {
                service::stop().await?;
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
                service::uninstall().await?;
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
                    match crate::process_util::classify_pid(pid_num) {
                        crate::process_util::PidLiveness::ProviderAlive => {
                            println!("Sending stop signal to PID {pid_trim}");
                            #[cfg(unix)]
                            {
                                use nix::sys::signal::{kill, Signal};
                                use nix::unistd::Pid;
                                let pid: i32 = pid_trim.parse()?;
                                kill(Pid::from_raw(pid), Signal::SIGTERM)?;
                                println!("Stop signal sent successfully.");
                            }
                            #[cfg(windows)]
                            {
                                match std::process::Command::new("taskkill")
                                    .args(["/PID", pid_trim, "/F"])
                                    .output()
                                {
                                    Ok(output) if output.status.success() => {
                                        println!("Stop signal sent successfully.");
                                    }
                                    Ok(output) => {
                                        let stderr = String::from_utf8_lossy(&output.stderr);
                                        println!(
                                            "Failed to stop process {pid_trim}: {}",
                                            stderr.trim()
                                        );
                                    }
                                    Err(err) => {
                                        println!(
                                            "Failed to run taskkill for PID {pid_trim}: {err}"
                                        );
                                    }
                                }
                            }
                            #[cfg(all(not(unix), not(windows)))]
                            {
                                println!(
                                    "Please terminate the provider-node process manually (PID: {pid_trim})"
                                );
                            }
                        }
                        crate::process_util::PidLiveness::ForeignAlive => {
                            println!(
                                "PID file points to unrelated process {pid_trim} — removing stale PID file only"
                            );
                        }
                        crate::process_util::PidLiveness::Dead => {
                            println!("Removing stale PID file (process {pid_trim} not running)");
                        }
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

/// Next gateway after a session: a healthy session re-earns the primary on the next
/// cycle, so one flaky night does not pin the node to a fallback; only a failed
/// session advances the failover rotation.
fn next_gateway_index(current: usize, total: usize, session_succeeded: bool) -> usize {
    if total == 0 || session_succeeded {
        0
    } else {
        (current + 1) % total
    }
}

/// True when reconnecting cannot succeed until the operator replaces api_key: the Control API
/// said the key is invalid, inactive or expired. An outage or a server error is not that, and
/// must not stop the loop; see `ip::is_key_refusal` for what counts and why.
fn is_fatal_provider_auth_error(msg: &str) -> bool {
    ip::is_key_refusal(msg)
}

fn write_pid_file(path: &std::path::Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, std::process::id().to_string())?;
    Ok(())
}

/// Exit with a hint unless `provider.toml` can be (over)written.
fn refuse_if_config_exists(config_path: &std::path::Path, force: bool) {
    if config_path.exists() && !force {
        eprintln!(
            "Config already exists at {}. Re-run with --force to overwrite.",
            config_path.display()
        );
        std::process::exit(1);
    }
}

/// `provider.toml` is already there and `--force` was not given.
#[derive(Debug)]
struct ConfigExists(std::path::PathBuf);

impl std::fmt::Display for ConfigExists {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Config already exists at {}. Re-run with --force to overwrite.",
            self.0.display()
        )
    }
}

impl std::error::Error for ConfigExists {}

/// What `write_provider_config` put on disk, for the caller to report.
struct WrittenConfig {
    path: std::path::PathBuf,
    node_id: String,
    gateway_addr: String,
    use_tls: bool,
    tls_skip_verify: bool,
    hotkey: Option<String>,
}

/// Write the ready-to-run `provider.toml` that both `join` and `pair` produce, and print the
/// confirmation banner. See `write_provider_config` for the arguments.
async fn install_provider_config(
    api_url: &str,
    gateway_addr: &str,
    api_key: &str,
    node_id: &str,
    config: Option<String>,
    force: bool,
    validate_key: bool,
) -> anyhow::Result<()> {
    let written = match write_provider_config(
        api_url,
        gateway_addr,
        api_key,
        node_id,
        config,
        force,
        validate_key,
    )
    .await
    {
        Ok(written) => written,
        Err(e) => match e.downcast_ref::<ConfigExists>() {
            Some(exists) => {
                eprintln!("{exists}");
                std::process::exit(1);
            }
            None => return Err(e),
        },
    };

    println!();
    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║              ✓ PROVIDER CONFIG INSTALLED                 ║");
    println!("╚══════════════════════════════════════════════════════════╝");
    println!();
    println!("Node ID: {}", written.node_id);
    println!(
        "Gateway: {} (TLS={}, skip_verify={})",
        written.gateway_addr, written.use_tls, written.tls_skip_verify
    );
    if let Some(hotkey) = &written.hotkey {
        println!("Provider hotkey: {hotkey}");
    }
    println!("Config written to: {}", written.path.display());
    println!();
    println!("Next:");
    println!("  provider-node start");
    Ok(())
}

/// The `pair --json` flow: every line on stdout is one event, and only the events.
/// `approved` is written after `provider.toml` is on disk; any failure is exactly one
/// terminal event and a non-zero exit.
async fn run_pair_json(
    api_url: String,
    gateway_addr: String,
    device_name: Option<String>,
    force: bool,
    config: Option<String>,
) -> anyhow::Result<()> {
    let mut out = std::io::stdout();
    let outcome: anyhow::Result<pair::Event> = async {
        let config_path = config
            .clone()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(paths::config_file);
        if config_path.exists() && !force {
            return Err(ConfigExists(config_path).into());
        }
        let granted = pair::run_json(&api_url, device_name, &mut out).await?;
        // The key is shown exactly once, so it is written before anything else can fail.
        let written = write_provider_config(
            &api_url,
            &gateway_addr,
            &granted.api_key,
            &granted.node_id,
            config,
            force,
            false,
        )
        .await?;
        Ok(pair::Event::Approved {
            node_id: written.node_id,
            config_path: written.path.display().to_string(),
        })
    }
    .await;

    match outcome {
        Ok(approved) => pair::emit(&mut out, &approved)?,
        Err(e) => {
            let _ = pair::emit(&mut out, &pair::failure_event(&e));
            std::process::exit(1);
        }
    }
    Ok(())
}

/// Build and save `provider.toml`. Prints nothing apart from the key check when
/// `validate_key` is set (`join` re-checks a key a person typed in; `pair` skips it because
/// the key was minted a moment ago), so a caller can use it with machine-readable output.
async fn write_provider_config(
    api_url: &str,
    gateway_addr: &str,
    api_key: &str,
    node_id: &str,
    config: Option<String>,
    force: bool,
    validate_key: bool,
) -> anyhow::Result<WrittenConfig> {
    if validate_key {
        println!("Authenticating with Control API…");
        let (_user_id, _jwt) = ip::validate_api_key(api_url, api_key).await?;
        println!("✓ API token accepted");
    }

    let config_path = config
        .map(std::path::PathBuf::from)
        .unwrap_or_else(paths::config_file);
    if config_path.exists() && !force {
        return Err(ConfigExists(config_path).into());
    }

    let host = gateway_addr
        .split(':')
        .next()
        .unwrap_or("proxy.proxyhubb.com")
        .to_string();
    let mut gateway_addrs = vec![];
    if gateway_addr.ends_with(":3128") {
        gateway_addrs.push(format!("{host}:8443"));
    }
    // J2 / production tunnel listeners are TLS (TLS_CERT_PATH). Loopback is
    // still TLS with a self-signed cert — do not force plaintext for 127.0.0.1
    // or yamux AUTH dies with decode EOF during the TLS handshake.
    let use_tls = true;
    let tls_skip_verify = host == "localhost" || host == "127.0.0.1";
    // Preserve existing hotkey on --force unless the file has none.
    let signing_key = if force && config_path.exists() {
        match config::Config::load(config_path.to_str().unwrap_or("")) {
            Ok(existing) if !existing.provider_signing_key.trim().is_empty() => {
                existing.provider_signing_key
            }
            _ => resolve_registration_signing_key(None, false)?,
        }
    } else {
        resolve_registration_signing_key(None, false)?
    };

    let cfg = config::Config {
        control_api_url: api_url.to_string(),
        gateway_addr: gateway_addr.to_string(),
        gateway_addrs,
        api_key: api_key.to_string(),
        node_id: node_id.to_string(),
        connection_type: "residential".to_string(),
        provider_signing_key: signing_key,
        use_tls,
        tls_skip_verify,
        ..config::Config::default()
    };
    cfg.save(&config_path)?;

    // The key was just generated or read back from the file, so this cannot fail in practice;
    // if it somehow did, the config is already saved and only the hotkey line is lost.
    let hotkey = if cfg.provider_signing_key.is_empty() {
        None
    } else {
        proofs::ProviderSigner::from_base58(&cfg.provider_signing_key)
            .ok()
            .map(|signer| signer.public_key().to_string())
    };
    Ok(WrittenConfig {
        path: config_path,
        node_id: node_id.to_string(),
        gateway_addr: gateway_addr.to_string(),
        use_tls,
        tls_skip_verify,
        hotkey,
    })
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

#[cfg(test)]
mod pair_config_tests {
    use super::*;

    /// A fresh directory under the OS temp dir, removed when dropped.
    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let dir = std::env::temp_dir().join(format!(
                "provider-node-test-{label}-{}-{nanos}",
                std::process::id()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }

        fn config(&self) -> String {
            self.0.join("provider.toml").to_string_lossy().into_owned()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    async fn write(config: String, key: &str, force: bool) -> anyhow::Result<WrittenConfig> {
        write_provider_config(
            "https://api.example.test",
            "proxy.example.test:3128",
            key,
            "node-1",
            Some(config),
            force,
            false,
        )
        .await
    }

    #[tokio::test]
    async fn writes_a_loadable_config_without_printing_or_validating() {
        let dir = TempDir::new("write");
        let written = write(dir.config(), "key-1", false).await.unwrap();

        assert_eq!(written.node_id, "node-1");
        assert!(written.hotkey.is_some(), "a signing key is generated");
        let loaded = config::Config::load(&dir.config()).unwrap();
        assert_eq!(loaded.api_key, "key-1");
        assert_eq!(loaded.node_id, "node-1");
        assert_eq!(loaded.control_api_url, "https://api.example.test");
        assert_eq!(loaded.gateway_addr, "proxy.example.test:3128");
        // :3128 gateways get the :8443 failover, as `join` has always done.
        assert_eq!(loaded.gateway_addrs, vec!["proxy.example.test:8443"]);
    }

    #[tokio::test]
    async fn refuses_to_overwrite_without_force_and_says_so_with_a_typed_error() {
        let dir = TempDir::new("exists");
        write(dir.config(), "key-1", false).await.unwrap();

        let err = write(dir.config(), "key-2", false).await.err().unwrap();
        let exists = err.downcast_ref::<ConfigExists>().expect("typed error");
        assert!(exists.to_string().contains("--force"), "{exists}");
        // The existing file is untouched.
        assert_eq!(
            config::Config::load(&dir.config()).unwrap().api_key,
            "key-1"
        );
    }

    #[tokio::test]
    async fn force_replaces_the_key_but_keeps_the_signing_key() {
        let dir = TempDir::new("force");
        write(dir.config(), "key-1", false).await.unwrap();
        let before = config::Config::load(&dir.config())
            .unwrap()
            .provider_signing_key;
        assert!(!before.is_empty());

        write(dir.config(), "key-2", true).await.unwrap();
        let after = config::Config::load(&dir.config()).unwrap();
        assert_eq!(after.api_key, "key-2");
        assert_eq!(
            after.provider_signing_key, before,
            "the hotkey must survive --force"
        );
    }
}
#[cfg(test)]
mod fatal_auth_tests {
    use super::*;

    /// What a failed key exchange really says: the server's words, then advice that is appended
    /// to every failure and always contains the word "token".
    fn exchange_failure(server_said: &str) -> String {
        ip::gateway_token_failure(server_said)
    }

    /// Reconnecting is worth trying again: the key is fine, the servers are not (a deploy, an
    /// overloaded proxy, a rate limit). Stopping the loop here leaves a healthy node dead.
    #[test]
    fn a_server_that_is_down_or_failing_never_stops_the_reconnect_loop() {
        let mut messages: Vec<String> = [
            "HTTP 502 Bad Gateway",
            "HTTP 503 Service Unavailable",
            "HTTP 504 Gateway Timeout",
            "HTTP 500 Internal Server Error",
            "HTTP 429 Too Many Requests",
            "Internal server error: security misconfiguration",
            "Failed to issue gateway token",
        ]
        .iter()
        .map(|said| exchange_failure(said))
        .collect();
        // Not even reaching the server.
        messages.push(
            "Failed to connect to Control API: error sending request for url \
             (https://api.proxyhubb.com/v1/provider/gateway-token)"
                .to_string(),
        );
        for msg in messages {
            assert!(!is_fatal_provider_auth_error(&msg), "stopped for: {msg}");
        }
    }

    /// An answer that is not from the control API says nothing about the key, so it is not a
    /// reason to stop either: a proxy or a firewall can answer 401/403 for its own reasons.
    #[test]
    fn a_401_or_403_that_is_not_the_servers_own_refusal_is_not_fatal() {
        for said in ["HTTP 401 Unauthorized", "HTTP 403 Forbidden"] {
            let msg = exchange_failure(said);
            assert!(!is_fatal_provider_auth_error(&msg), "stopped for: {msg}");
        }
    }

    /// The control API said the key is no good (these are its own words, from
    /// `issueGatewayToken`): nothing will change until the person replaces it.
    #[test]
    fn a_key_the_server_itself_refused_stops_the_loop() {
        for said in [
            "Invalid or inactive provider token",
            "Provider token expired",
        ] {
            let msg = exchange_failure(said);
            assert!(is_fatal_provider_auth_error(&msg), "kept going for: {msg}");
        }
    }

    /// The advice alone must never read as a refusal, or every failure would.
    #[test]
    fn the_advice_appended_to_every_failure_is_not_a_refusal() {
        assert!(!is_fatal_provider_auth_error(&exchange_failure("")));
    }

    /// The gateway rejecting the handshake ("Auth failed: ...") has never stopped the loop, and
    /// this change does not make it start.
    #[test]
    fn a_gateway_handshake_rejection_is_still_retried() {
        assert!(!is_fatal_provider_auth_error(
            "Auth failed: rejected by gateway"
        ));
    }
}

#[cfg(test)]
mod gateway_tests {
    use super::*;

    #[test]
    fn a_healthy_session_re_earns_the_primary() {
        assert_eq!(next_gateway_index(0, 2, true), 0);
        assert_eq!(next_gateway_index(1, 2, true), 0);
        assert_eq!(next_gateway_index(3, 4, true), 0);
    }

    #[test]
    fn a_failed_session_advances_and_wraps_the_rotation() {
        assert_eq!(next_gateway_index(0, 2, false), 1);
        assert_eq!(next_gateway_index(1, 2, false), 0);
        assert_eq!(next_gateway_index(2, 3, false), 0);
    }

    #[test]
    fn a_single_gateway_never_moves() {
        assert_eq!(next_gateway_index(0, 1, true), 0);
        assert_eq!(next_gateway_index(0, 1, false), 0);
    }

    #[test]
    fn an_empty_list_is_safe() {
        assert_eq!(next_gateway_index(0, 0, true), 0);
        assert_eq!(next_gateway_index(5, 0, false), 0);
    }
}
