//! Proxy handler: the exit-node logic that bridges Yamux streams to the internet.

use crate::config::Config;
use crate::stats::Collector;

use futures_util::{AsyncReadExt, AsyncWriteExt};
use std::net::IpAddr;
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncReadCompatExt;
use tracing::{debug, error, warn};

/// Handles incoming proxy requests from the Edge Gateway.
#[derive(Clone)]
pub struct ProxyHandler {
    allowed_ports: Vec<u16>,
    blocked_hosts: Vec<String>,
    stats: Collector,
}

impl ProxyHandler {
    pub fn new(cfg: &Config, stats: Collector) -> Self {
        Self {
            allowed_ports: cfg.allowed_ports.clone(),
            blocked_hosts: cfg.blocked_hosts.clone(),
            stats,
        }
    }

    /// Handle a single Yamux stream (one proxy request).
    pub async fn handle_stream(&self, mut stream: yamux::Stream) {
        // 1. Read the initial data. We need to be careful not to swallow
        // data that belongs to the proxied connection (like TLS Client Hello).
        let mut buf = [0u8; 4096];
        let n = match stream.read(&mut buf).await {
            Ok(n) if n > 0 => n,
            _ => return,
        };

        // Find the first newline which separates the command from any following data
        let (line_bytes, leftover) = match buf[..n].iter().position(|&b| b == b'\n') {
            Some(pos) => (&buf[..pos], &buf[pos + 1..n]),
            None => (&buf[..n], &buf[0..0]), // No newline found yet, unlikely for this protocol
        };

        let line = String::from_utf8_lossy(line_bytes);
        let line = line.trim();
        let parts: Vec<&str> = line.splitn(2, ' ').collect();

        if parts.len() < 2 {
            // Stats and Ping don't always have a target
            match parts[0] {
                "STATS" => {
                    self.handle_stats(&mut stream).await;
                    return;
                }
                "PING" => {
                    let _ = stream.write_all(b"PONG\n").await;
                    return;
                }
                _ => {
                    let _ = stream.write_all(b"ERROR Invalid command\n").await;
                    return;
                }
            }
        }

        let (cmd, target) = (parts[0], parts[1]);

        match cmd {
            "CONNECT" => self.handle_connect(&mut stream, target, leftover).await,
            "STATS" => self.handle_stats(&mut stream).await,
            "PING" => {
                let _ = stream.write_all(b"PONG\n").await;
            }
            other => {
                let _ = stream
                    .write_all(format!("ERROR Unknown command: {other}\n").as_bytes())
                    .await;
            }
        }
    }

    /// Execute an HTTP CONNECT: validate → dial target → bridge.
    async fn handle_connect(&self, stream: &mut yamux::Stream, target: &str, leftover: &[u8]) {
        debug!(target, "CONNECT request");

        // Validate target
        if !self.is_valid_target(target) {
            warn!(target, "Invalid target rejected");
            let _ = stream
                .write_all(b"ERROR Invalid target: access denied\n")
                .await;
            return;
        }

        if !self.is_port_allowed(target) {
            warn!(target, "Port not allowed");
            let _ = stream.write_all(b"ERROR Port not allowed\n").await;
            return;
        }

        if self.is_host_blocked(target) {
            warn!(target, "Host blocked");
            let _ = stream.write_all(b"ERROR Host blocked\n").await;
            return;
        }

        // Connect to the target
        let target_conn = match TcpStream::connect(target).await {
            Ok(c) => c,
            Err(e) => {
                error!(target, error = %e, "Failed to connect to target");
                let _ = stream
                    .write_all(format!("ERROR Connection failed: {e}\n").as_bytes())
                    .await;
                return;
            }
        };

        debug!(target, "Target connected");

        // Send OK
        if let Err(e) = stream.write_all(b"OK\n").await {
            error!(target, error = %e, "Failed to send OK response");
            return;
        }
        let _ = stream.flush().await;

        // Bridge bidirectionally
        self.bridge(stream, target_conn, leftover).await;
    }

    /// Bidirectional bridge between a yamux stream (futures I/O) and a tokio TcpStream.
    async fn bridge(&self, stream: &mut yamux::Stream, target: TcpStream, leftover: &[u8]) {
        use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
        use tokio_util::compat::FuturesAsyncReadCompatExt;
        use tracing::info;

        let mut target = target;

        // 1. Forward leftover bytes to target if any
        if !leftover.is_empty() {
            info!("Forwarding {} leftover bytes to target", leftover.len());
            if let Err(e) = target.write_all(leftover).await {
                error!(error = %e, "Failed to write leftover data to target");
                return;
            }
            let _ = target.flush().await;
        }

        // 2. Convert yamux stream to tokio-compatible
        let mut stream_compat = stream.compat();

        info!("Starting bidirectional bridge (copy_bidirectional)");

        // We use copy_bidirectional which is highly optimized and robust.
        // For stats, we'll just record the final counts after it finishes.
        match tokio::io::copy_bidirectional(&mut stream_compat, &mut target).await {
            Ok((from_stream, to_stream)) => {
                info!(from_stream, to_stream, "Bridge closed normally");
                self.stats.record_bytes_up(to_stream);
                self.stats.record_bytes_down(from_stream);
            }
            Err(e) => {
                info!("Bridge closed with error: {}", e);
            }
        }
        info!("Bridge closed");
    }

    async fn handle_stats(&self, stream: &mut yamux::Stream) {
        let snap = self.stats.snapshot();
        let resp = format!(
            "ACTIVE:{} UP:{} DOWN:{} TOTAL:{}\n",
            snap.active_connections, snap.bytes_up, snap.bytes_down, snap.total_connections,
        );
        let _ = stream.write_all(resp.as_bytes()).await;
    }

    // ── Validation helpers ──────────────────────────────────────────

    fn is_valid_target(&self, target: &str) -> bool {
        let Some((host, _port)) = target.rsplit_once(':') else {
            return false;
        };

        if host.is_empty() {
            return false;
        }

        // If it parses as an IP, check for reserved ranges
        if let Ok(ip) = host.parse::<IpAddr>() {
            if ip.is_loopback() || ip.is_multicast() || ip.is_unspecified() {
                return false;
            }
            match ip {
                IpAddr::V4(v4) => {
                    if v4.is_private() || v4.is_link_local() {
                        return false;
                    }
                }
                IpAddr::V6(v6) => {
                    let segments = v6.segments();
                    if (segments[0] & 0xfe00) == 0xfc00 {
                        return false;
                    }
                }
            }
        }

        true
    }

    fn is_port_allowed(&self, target: &str) -> bool {
        if self.allowed_ports.is_empty() {
            return true;
        }
        let Some(port_str) = target.rsplit_once(':').map(|(_, p)| p) else {
            return false;
        };
        let Ok(port) = port_str.parse::<u16>() else {
            return false;
        };
        self.allowed_ports.contains(&port)
    }

    fn is_host_blocked(&self, target: &str) -> bool {
        let Some((host, _)) = target.rsplit_once(':') else {
            return false;
        };
        let host_lower = host.to_lowercase();
        self.blocked_hosts
            .iter()
            .any(|b| host_lower.contains(&b.to_lowercase()))
    }
}
