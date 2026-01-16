// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod tls; // Declare TLS module

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use tokio::net::TcpStream;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_util::compat::{TokioAsyncReadCompatExt, FuturesAsyncReadCompatExt};
use yamux::{Config, Connection, Mode, WindowUpdateMode};
use futures_util::StreamExt;
use serde::{Serialize, Deserialize};
use chrono::{Local, Timelike, Weekday, Datelike};
use crate::tls::{TlsConfig, create_tls_connector};

// Global state for connection and stats
static mut PROVIDER_STATE: Option<ProviderState> = None;

struct ProviderState {
    connected: AtomicBool,
    should_reconnect: AtomicBool,
    total_bytes_up: AtomicU64,
    total_bytes_down: AtomicU64,
    total_connections: AtomicU64,
    active_connections: AtomicU64,
    session_start: Mutex<Option<std::time::Instant>>,
    settings: Mutex<ProviderSettings>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ProviderSettings {
    pub auto_connect: bool,
    pub auto_reconnect: bool,
    pub reconnect_delay_secs: u64,
    pub max_reconnect_attempts: u32,
    pub daily_bandwidth_limit_gb: f64,  // 0 = unlimited
    pub monthly_bandwidth_limit_gb: f64, // 0 = unlimited
    pub schedule_enabled: bool,
    pub schedule_start_hour: u32,  // 0-23
    pub schedule_end_hour: u32,    // 0-23
    pub schedule_days: Vec<String>, // ["Monday", "Tuesday", ...]
    pub gateway_url: String,
}

impl Default for ProviderSettings {
    fn default() -> Self {
        Self {
            auto_connect: false,
            auto_reconnect: true,
            reconnect_delay_secs: 5,
            max_reconnect_attempts: 10,
            daily_bandwidth_limit_gb: 0.0,
            monthly_bandwidth_limit_gb: 0.0,
            schedule_enabled: false,
            schedule_start_hour: 8,
            schedule_end_hour: 22,
            schedule_days: vec![
                "Monday".to_string(),
                "Tuesday".to_string(),
                "Wednesday".to_string(),
                "Thursday".to_string(),
                "Friday".to_string(),
            ],
            gateway_url: "127.0.0.1:4000".to_string(),
        }
    }
}

impl ProviderState {
    fn new() -> Self {
        Self {
            connected: AtomicBool::new(false),
            should_reconnect: AtomicBool::new(true),
            total_bytes_up: AtomicU64::new(0),
            total_bytes_down: AtomicU64::new(0),
            total_connections: AtomicU64::new(0),
            active_connections: AtomicU64::new(0),
            session_start: Mutex::new(None),
            settings: Mutex::new(ProviderSettings::default()),
        }
    }

    fn global() -> &'static ProviderState {
        unsafe {
            if PROVIDER_STATE.is_none() {
                PROVIDER_STATE = Some(ProviderState::new());
            }
            PROVIDER_STATE.as_ref().unwrap()
        }
    }
    
    fn is_within_schedule(&self) -> bool {
        let settings = self.settings.lock().unwrap();
        if !settings.schedule_enabled {
            return true;
        }
        
        let now = Local::now();
        let current_hour = now.hour();
        let current_day = match now.weekday() {
            Weekday::Mon => "Monday",
            Weekday::Tue => "Tuesday",
            Weekday::Wed => "Wednesday",
            Weekday::Thu => "Thursday",
            Weekday::Fri => "Friday",
            Weekday::Sat => "Saturday",
            Weekday::Sun => "Sunday",
        };
        
        // Check if current day is in schedule
        if !settings.schedule_days.iter().any(|d| d == current_day) {
            return false;
        }
        
        // Check if current hour is within range
        if settings.schedule_start_hour <= settings.schedule_end_hour {
            current_hour >= settings.schedule_start_hour && current_hour < settings.schedule_end_hour
        } else {
            // Handles overnight schedules (e.g., 22:00 - 06:00)
            current_hour >= settings.schedule_start_hour || current_hour < settings.schedule_end_hour
        }
    }
    
    fn is_within_bandwidth_limit(&self) -> bool {
        let settings = self.settings.lock().unwrap();
        if settings.daily_bandwidth_limit_gb <= 0.0 {
            return true;
        }
        
        let total_bytes = self.total_bytes_up.load(Ordering::Relaxed) 
            + self.total_bytes_down.load(Ordering::Relaxed);
        let total_gb = total_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
        
        total_gb < settings.daily_bandwidth_limit_gb
    }
}

#[derive(Serialize)]
struct ProviderStats {
    connected: bool,
    total_bytes_up: u64,
    total_bytes_down: u64,
    total_gb: f64,
    total_connections: u64,
    active_connections: u64,
    earnings_ghs: f64,
    session_duration_secs: u64,
    within_schedule: bool,
    within_bandwidth_limit: bool,
}

#[derive(Serialize)]
struct EarningsInfo {
    total_bytes: u64,
    total_gb: f64,
    earnings_ghs: f64,
    earnings_per_gb: f64,
    pending_payout: f64,
    lifetime_earnings: f64,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_provider_stats() -> ProviderStats {
    let state = ProviderState::global();
    let bytes_up = state.total_bytes_up.load(Ordering::Relaxed);
    let bytes_down = state.total_bytes_down.load(Ordering::Relaxed);
    let total_bytes = bytes_up + bytes_down;
    let total_gb = total_bytes as f64 / (1024.0 * 1024.0 * 1024.0);

    // Provider earns 40% of 0.50 GHS/GB = 0.20 GHS/GB
    let earnings_ghs = total_gb * 0.20;
    
    // Calculate session duration
    let session_duration_secs = state.session_start.lock().unwrap()
        .map(|start| start.elapsed().as_secs())
        .unwrap_or(0);

    ProviderStats {
        connected: state.connected.load(Ordering::Relaxed),
        total_bytes_up: bytes_up,
        total_bytes_down: bytes_down,
        total_gb,
        total_connections: state.total_connections.load(Ordering::Relaxed),
        active_connections: state.active_connections.load(Ordering::Relaxed),
        earnings_ghs,
        session_duration_secs,
        within_schedule: state.is_within_schedule(),
        within_bandwidth_limit: state.is_within_bandwidth_limit(),
    }
}

#[tauri::command]
fn get_earnings() -> EarningsInfo {
    let state = ProviderState::global();
    let bytes_up = state.total_bytes_up.load(Ordering::Relaxed);
    let bytes_down = state.total_bytes_down.load(Ordering::Relaxed);
    let total_bytes = bytes_up + bytes_down;
    let total_gb = total_bytes as f64 / (1024.0 * 1024.0 * 1024.0);

    // Provider earns 40% of 0.50 GHS/GB = 0.20 GHS/GB
    let earnings_per_gb = 0.20;
    let earnings_ghs = total_gb * earnings_per_gb;

    EarningsInfo {
        total_bytes,
        total_gb,
        earnings_ghs,
        earnings_per_gb,
        pending_payout: earnings_ghs, // For now, all earnings are pending
        lifetime_earnings: 0.0,  // Would come from server
    }
}

#[tauri::command]
fn get_settings() -> ProviderSettings {
    let state = ProviderState::global();
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn update_settings(settings: ProviderSettings) -> Result<String, String> {
    let state = ProviderState::global();
    *state.settings.lock().unwrap() = settings;
    Ok("Settings updated".to_string())
}

#[tauri::command]
fn disconnect_gateway() -> Result<String, String> {
    let state = ProviderState::global();
    state.connected.store(false, Ordering::Relaxed);
    state.should_reconnect.store(false, Ordering::Relaxed);
    *state.session_start.lock().unwrap() = None;
    Ok("Disconnected".to_string())
}

#[tauri::command]
async fn connect_gateway(_app_handle: tauri::AppHandle, gateway_url: String) -> Result<String, String> {
    let state = ProviderState::global();
    
    // Check schedule
    if !state.is_within_schedule() {
        return Err("Outside of scheduled hours. Enable schedule or adjust times.".to_string());
    }
    
    // Check bandwidth limit
    if !state.is_within_bandwidth_limit() {
        return Err("Daily bandwidth limit reached.".to_string());
    }
    
    state.should_reconnect.store(true, Ordering::Relaxed);
    
    // Update gateway URL in settings
    {
        let mut settings = state.settings.lock().unwrap();
        settings.gateway_url = gateway_url.clone();
    }
    
    println!("Connecting to gateway at {}", gateway_url);
    
    // In v1 we connect to the Tunnel Server port (4000)
    // Expect gateway_url like "127.0.0.1:4000"
    
    // Check for TLS configuration via environment variables
    let tls_ca = std::env::var("TLS_CA_FILE").ok();
    let tls_cert = std::env::var("TLS_CERT_FILE").ok();
    let tls_key = std::env::var("TLS_KEY_FILE").ok();
    
    let domain = gateway_url.split(':').next().unwrap_or("localhost").to_string();

    // Attempt connection
    let stream = TcpStream::connect(&gateway_url).await.map_err(|e| e.to_string())?;
    println!("Connected to TCP");
    
    // Record session start
    *state.session_start.lock().unwrap() = Some(std::time::Instant::now());

    if let Some(ca_path) = tls_ca {
        println!("🔒 Upgrading to TLS...");
        let config = TlsConfig::new(&ca_path, tls_cert.as_deref(), tls_key.as_deref());
        
        match create_tls_connector(&config) {
            Ok(connector) => {
                let domain = rustls::pki_types::ServerName::try_from(domain)
                   .map_err(|_| "Invalid domain for TLS".to_string())?;

                match connector.connect(domain, stream).await {
                    Ok(tls_stream) => {
                         println!("✅ TLS Handshake Complete");
                         handle_connection(Box::new(tls_stream)).await?;
                    },
                    Err(e) => return Err(format!("TLS Handshake Failed: {}", e))
                }
            },
            Err(e) => return Err(format!("Failed to create TLS connector: {}", e))
        }
    } else {
        println!("⚠️  Using Plaintext Connection (No TLS configured)");
        handle_connection(Box::new(stream)).await?;
    }
    
    state.connected.store(true, Ordering::Relaxed);
    Ok("Connected".to_string())
}

async fn handle_connection<S>(stream: Box<S>) -> Result<(), String> 
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let stream = stream.compat();
    let mut cfg = Config::default();
    cfg.set_window_update_mode(WindowUpdateMode::OnRead);

    // Client Mode
    let conn = Connection::new(stream, cfg, Mode::Client);
    
    println!("Yamux handshake complete");

    // Convert to stream and get the incoming streams
    let incoming = yamux::into_stream(conn);
    
    // Spawn the connection driver loop in background
    tauri::async_runtime::spawn(async move {
        tokio::pin!(incoming);
        
        let state = ProviderState::global();
        
        // v1: Accept streams routed from Gateway
        while let Some(result) = incoming.next().await {
            // Check bandwidth limit during operation
            if !state.is_within_bandwidth_limit() {
                println!("Bandwidth limit reached, disconnecting...");
                state.connected.store(false, Ordering::Relaxed);
                break;
            }
            
            match result {
                Ok(mut stream) => {
                    println!("Gateway opened a stream!");
                    
                    state.total_connections.fetch_add(1, Ordering::Relaxed);
                    state.active_connections.fetch_add(1, Ordering::Relaxed);
                    
                    // Handle Stream in task
                    tauri::async_runtime::spawn(async move {
                        use futures_util::{AsyncReadExt, AsyncWriteExt};
                        
                        // Read the CONNECT command
                        let mut buf = [0u8; 256];
                        
                        let n = match stream.read(&mut buf).await {
                            Ok(n) if n > 0 => n,
                            _ => {
                                ProviderState::global().active_connections.fetch_sub(1, Ordering::Relaxed);
                                return;
                            }
                        };
                        
                        let command = String::from_utf8_lossy(&buf[..n]).to_string();
                        let parts: Vec<&str> = command.trim().split_whitespace().collect();
                        
                        if parts.len() == 2 && parts[0] == "CONNECT" {
                            let target = parts[1];
                            println!("Dialing target: {}", target);
                            
                            match TcpStream::connect(target).await {
                                Ok(remote) => {
                                    // Send OK
                                    if let Err(_) = stream.write_all(b"OK\n").await {
                                        ProviderState::global().active_connections.fetch_sub(1, Ordering::Relaxed);
                                        return;
                                    }
                                    
                                    // Bridge: yamux stream is futures-io, TcpStream is tokio
                                    let mut yamux_stream = stream.compat();
                                    let mut tokio_remote = remote;
                                    
                                    let result = tokio::io::copy_bidirectional(&mut yamux_stream, &mut tokio_remote).await;
                                    
                                    let state = ProviderState::global();
                                    match result {
                                        Ok((from_client, from_remote)) => {
                                            println!("Tunnel closed: {}/{}", from_client, from_remote);
                                            state.total_bytes_up.fetch_add(from_client, Ordering::Relaxed);
                                            state.total_bytes_down.fetch_add(from_remote, Ordering::Relaxed);
                                        }
                                        Err(e) => {
                                            println!("Bridge error: {}", e);
                                        }
                                    }
                                    state.active_connections.fetch_sub(1, Ordering::Relaxed);
                                },
                                Err(e) => {
                                    println!("Failed to dial: {}", e);
                                    let _ = stream.write_all(format!("ERR {}\n", e).as_bytes()).await;
                                    ProviderState::global().active_connections.fetch_sub(1, Ordering::Relaxed);
                                }
                            }
                        } else {
                            ProviderState::global().active_connections.fetch_sub(1, Ordering::Relaxed);
                        }
                    });
                }
                Err(e) => {
                    eprintln!("Stream error: {}", e);
                    break;
                }
            }
        }
        
        println!("Connection lost");
        state.connected.store(false, Ordering::Relaxed);
        
        // Auto-reconnect logic
        if state.should_reconnect.load(Ordering::Relaxed) {
            let settings = state.settings.lock().unwrap().clone();
            if settings.auto_reconnect {
                let delay = settings.reconnect_delay_secs;
                let max_attempts = settings.max_reconnect_attempts;
                let gateway_url = settings.gateway_url.clone();
                drop(settings);
                
                println!("Auto-reconnect enabled, attempting in {} seconds...", delay);
                
                tauri::async_runtime::spawn(async move {
                    for attempt in 1..=max_attempts {
                        tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
                        
                        let state = ProviderState::global();
                        if !state.should_reconnect.load(Ordering::Relaxed) {
                            println!("Reconnect cancelled");
                            break;
                        }
                        
                        if !state.is_within_schedule() {
                            println!("Outside schedule, skipping reconnect");
                            continue;
                        }
                        
                        println!("Reconnect attempt {}/{}", attempt, max_attempts);
                        
                        match TcpStream::connect(&gateway_url).await {
                            Ok(stream) => {
                                state.connected.store(true, Ordering::Relaxed);
                                *state.session_start.lock().unwrap() = Some(std::time::Instant::now());
                                if let Err(e) = handle_connection(Box::new(stream)).await {
                                    println!("Reconnect failed: {}", e);
                                } else {
                                    println!("Reconnected successfully");
                                    break;
                                }
                            }
                            Err(e) => {
                                println!("Reconnect attempt {} failed: {}", attempt, e);
                            }
                        }
                    }
                });
            }
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // System tray setup
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;

            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let connect_item = MenuItem::with_id(app, "connect", "Connect", true, None::<&str>)?;
            let disconnect_item = MenuItem::with_id(app, "disconnect", "Disconnect", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[
                &show_item,
                &connect_item,
                &disconnect_item,
                &quit_item,
            ])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("ProxyHub Provider - Click to open")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "connect" => {
                            let state = ProviderState::global();
                            if !state.connected.load(Ordering::Relaxed) {
                                let settings = state.settings.lock().unwrap().clone();
                                let gateway_url = settings.gateway_url.clone();
                                drop(settings);
                                
                                tauri::async_runtime::spawn(async move {
                                    let state = ProviderState::global();
                                    if !state.is_within_schedule() {
                                        println!("Cannot connect: outside schedule");
                                        return;
                                    }
                                    if !state.is_within_bandwidth_limit() {
                                        println!("Cannot connect: bandwidth limit reached");
                                        return;
                                    }
                                    
                                    println!("Tray: Connecting to {}", gateway_url);
                                    if let Ok(stream) = TcpStream::connect(&gateway_url).await {
                                        state.connected.store(true, Ordering::Relaxed);
                                        state.should_reconnect.store(true, Ordering::Relaxed);
                                        *state.session_start.lock().unwrap() = Some(std::time::Instant::now());
                                        let _ = handle_connection(Box::new(stream)).await;
                                    }
                                });
                            }
                        }
                        "disconnect" => {
                            let state = ProviderState::global();
                            state.connected.store(false, Ordering::Relaxed);
                            state.should_reconnect.store(false, Ordering::Relaxed);
                            *state.session_start.lock().unwrap() = None;
                            println!("Tray: Disconnected");
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    use tauri::tray::TrayIconEvent;
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            connect_gateway,
            disconnect_gateway,
            get_provider_stats,
            get_earnings,
            get_settings,
            update_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
