//! Tunnel client: manages the Yamux-multiplexed reverse tunnel to the Edge Gateway.

use crate::config::Config;
use crate::proxy::handler::ProxyHandler;
use crate::stats::Collector;

use anyhow::{Context, Result};
use base64::Engine;
use futures_util::{AsyncReadExt as _, AsyncWriteExt as _, StreamExt};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tokio_util::compat::TokioAsyncReadCompatExt;
use tracing::{debug, error, info, warn};
use yamux::{Control, Stream};

/// Capabilities the provider declares to the gateway.
#[derive(Clone, serde::Serialize)]
pub struct CapabilityInfo {
    pub max_connections: u32,
    pub max_bandwidth_mbps: u32,
    pub available_ports: Vec<u16>,
    pub connection_type: String,
    pub uplink_speed_kbps: u32,
    pub downlink_speed_kbps: u32,
    pub cpu_cores: u32,
    pub memory_mb: u32,
    pub os: String,
    pub client_version: String,
    pub features: Vec<String>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub provider_lease: String,
}

pub struct TunnelClient {
    config: Config,
    stats: Collector,
    ctrl: Option<Control>,
    incoming_rx: Option<tokio::sync::mpsc::Receiver<yamux::Stream>>,
    _conn_task: Option<tokio::task::JoinHandle<()>>,
    runtime_node_id: Option<String>,
}

impl TunnelClient {
    pub fn new(cfg: &Config, stats: Collector) -> Self {
        Self {
            config: cfg.clone(),
            stats,
            ctrl: None,
            incoming_rx: None,
            _conn_task: None,
            runtime_node_id: None,
        }
    }

    pub async fn connect(&mut self) -> Result<()> {
        let tcp = TcpStream::connect(&self.config.gateway_addr)
            .await
            .with_context(|| format!("TCP dial to {} failed", self.config.gateway_addr))?;

        debug!(addr = %self.config.gateway_addr, "TCP connected");

        let mut cfg = yamux::Config::default();
        cfg.set_receive_window(4 * 1024 * 1024);
        cfg.set_max_num_streams(1000);
        cfg.set_window_update_mode(yamux::WindowUpdateMode::OnRead);

        let (tx, rx) = tokio::sync::mpsc::channel(256);
        let config_clone = self.config.clone();

        let (conn_task, mut ctrl) = if self.config.use_tls {
            let connector = build_tls_connector(&self.config)?;
            let domain = extract_host(&self.config.gateway_addr);
            let server_name = rustls::pki_types::ServerName::try_from(domain.as_str())
                .map_err(|_| anyhow::anyhow!("Invalid TLS server name"))?
                .to_owned();
            let tls_stream = connector.connect(server_name, tcp).await?;
            debug!("TLS handshake complete");

            let conn = yamux::Connection::new(tls_stream.compat(), cfg, yamux::Mode::Client);
            let ctrl = conn.control();
            (tokio::spawn(Self::drive_only(conn, tx)), ctrl)
        } else {
            let conn = yamux::Connection::new(tcp.compat(), cfg, yamux::Mode::Client);
            let ctrl = conn.control();
            (tokio::spawn(Self::drive_only(conn, tx)), ctrl)
        };

        // NOW perform the handshake on the main task
        let (token, provider_user_id) = if !self.config.jwt_token.is_empty() {
            let token = self.config.jwt_token.clone();
            let provider_user_id = resolve_runtime_provider_user_id(&token);
            (token, provider_user_id)
        } else {
            let (user_id, jwt) =
                crate::ip::validate_api_key(&self.config.control_api_url, &self.config.api_key)
                    .await?;
            self.config.jwt_token = jwt.clone();
            let provider_user_id =
                normalize_user_id(&user_id).or_else(|| resolve_runtime_provider_user_id(&jwt));
            (jwt, provider_user_id)
        };

        self.runtime_node_id = Some(resolve_runtime_node_id(&self.config, provider_user_id)?);

        match self.perform_handshake(&mut ctrl, token, config_clone).await {
            Ok(_) => {
                self.ctrl = Some(ctrl);
                self.incoming_rx = Some(rx);
                self._conn_task = Some(conn_task);
                info!("Handshake complete, tunnel established");
                Ok(())
            }
            Err(e) => {
                conn_task.abort();
                Err(e)
            }
        }
    }

    async fn drive_only<S>(conn: yamux::Connection<S>, tx: tokio::sync::mpsc::Sender<Stream>)
    where
        S: futures::AsyncRead + futures::AsyncWrite + Unpin + Send + 'static,
    {
        let mut incoming = Box::pin(yamux::into_stream(conn));
        loop {
            tokio::select! {
                result = incoming.next() => {
                    match result {
                        Some(Ok(stream)) => {
                            debug!("Received inbound stream: {}", stream.id());
                            if tx.send(stream).await.is_err() { break; }
                        }
                        Some(Err(e)) => {
                            error!("Yamux error: {e}");
                            break;
                        }
                        None => break,
                    }
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(10)) => {
                    // Heartbeat poll to force outgoing data flush in Yamux 0.10
                }
            }
        }
        debug!("Yamux driver task finished");
    }

    async fn perform_handshake(
        &self,
        ctrl: &mut Control,
        token: String,
        config: Config,
    ) -> Result<()> {
        // AUTH
        debug!("Handshake: Starting AUTH...");
        let mut auth_stream = ctrl
            .open_stream()
            .await
            .context("failed to open auth stream")?;
        auth_stream
            .write_all(format!("AUTH {token}\n").as_bytes())
            .await?;
        auth_stream.flush().await?;

        let mut buf = [0u8; 64];
        let n = auth_stream.read(&mut buf).await?;
        let resp = String::from_utf8_lossy(&buf[..n]);
        if resp.trim() != "OK" {
            anyhow::bail!("Auth failed: {resp}");
        }
        info!("Handshake: AUTH successful");
        auth_stream.close().await?;

        // CAPABILITY
        debug!("Handshake: Sending CAPABILITIES...");
        let mut cap_stream = ctrl
            .open_stream()
            .await
            .context("failed to open capability stream")?;
        let (mut caps, lease_request) = build_provider_capability_payload(&config);

        match crate::ip::fetch_provider_lease(&config.control_api_url, &token, &lease_request).await
        {
            Ok(lease) => {
                caps.provider_lease = lease.token;
                info!("Handshake: provider lease acquired");
            }
            Err(err) => {
                if crate::lease_policy::provider_leases_required() {
                    anyhow::bail!("provider lease required but unavailable: {err}");
                }
                warn!(
                    "Handshake: provider lease unavailable, continuing without lease: {}",
                    err
                );
            }
        }

        let caps_json = serde_json::to_string(&caps)?;
        cap_stream
            .write_all(format!("CAPABILITY {caps_json}\n").as_bytes())
            .await?;
        cap_stream.flush().await?;

        let mut buf = [0u8; 4096];
        let n = cap_stream.read(&mut buf).await?;
        let resp = String::from_utf8_lossy(&buf[..n]);
        if !resp.trim().starts_with("ACK") {
            anyhow::bail!("Capability failed: {resp}");
        }
        info!("Handshake: CAPABILITIES acknowledged");
        cap_stream.close().await?;
        Ok(())
    }

    pub fn session_handle(&self) -> Control {
        self.ctrl.clone().expect("not connected")
    }

    pub fn auth_token(&self) -> String {
        self.config.jwt_token.clone()
    }

    pub fn control_api_url(&self) -> String {
        self.config.control_api_url.clone()
    }

    pub fn runtime_node_id(&self) -> String {
        self.runtime_node_id.clone().expect("not connected")
    }

    pub fn provider_lease_request(&self) -> crate::ip::ProviderLeaseRequest {
        build_provider_capability_payload(&self.config).1
    }

    pub async fn accept_streams(&mut self, handler: ProxyHandler) -> Result<()> {
        let handler = Arc::new(handler);
        let rx = self.incoming_rx.as_mut().expect("not connected");

        while let Some(stream) = rx.recv().await {
            let h = handler.clone();
            let stats = self.stats.clone();
            stats.record_connection_opened();
            tokio::spawn(async move {
                h.handle_stream(stream).await;
                stats.record_connection_closed();
            });
        }
        Err(anyhow::anyhow!("Connection closed"))
    }

    pub async fn close(&mut self) {
        if let Some(mut ctrl) = self.ctrl.take() {
            let _ = ctrl.close().await;
        }
        if let Some(task) = self._conn_task.take() {
            task.abort();
        }
        info!("Connection closed");
    }
}

fn build_tls_connector(config: &Config) -> Result<TlsConnector> {
    let tls_config = if config.tls_skip_verify {
        rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(SkipServerCertVerify))
            .with_no_client_auth()
    } else {
        let mut root_store = rustls::RootCertStore::empty();
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        rustls::ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth()
    };
    Ok(TlsConnector::from(Arc::new(tls_config)))
}

#[derive(Debug)]
struct SkipServerCertVerify;

impl rustls::client::danger::ServerCertVerifier for SkipServerCertVerify {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

fn extract_host(addr: &str) -> String {
    addr.split(':').next().unwrap_or(addr).to_string()
}

fn resolve_runtime_node_id(config: &Config, provider_user_id: Option<String>) -> Result<String> {
    if let Some(user_id) = provider_user_id {
        let runtime_node_id = format!("node_{}", user_id);
        let configured_node_id = config.node_id.trim();
        if !configured_node_id.is_empty() && configured_node_id != runtime_node_id {
            warn!(
                configured_node_id = configured_node_id,
                runtime_node_id = %runtime_node_id,
                "Ignoring configured node_id in favor of runtime-authenticated provider identity"
            );
        }
        return Ok(runtime_node_id);
    }

    let configured_node_id = config.node_id.trim();
    if configured_node_id.is_empty() {
        anyhow::bail!("unable to derive provider node_id from authenticated runtime identity");
    }

    warn!(
        fallback_node_id = configured_node_id,
        "Falling back to configured node_id because the runtime auth token did not expose a provider identity"
    );
    Ok(configured_node_id.to_string())
}

fn resolve_runtime_provider_user_id(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    let claims: RuntimeIdentityClaims = serde_json::from_slice(&decoded).ok()?;
    claims
        .user_id
        .or(claims.sub)
        .and_then(|value| normalize_user_id(&value))
}

fn normalize_user_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[derive(serde::Deserialize)]
struct RuntimeIdentityClaims {
    #[serde(default)]
    sub: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
}

fn build_provider_capability_payload(
    config: &Config,
) -> (CapabilityInfo, crate::ip::ProviderLeaseRequest) {
    let system = crate::sys::collect();
    let mut features = vec!["ipv4".to_string(), "http_connect".to_string()];
    if config.use_tls {
        features.push("tls_tunnel".to_string());
    }

    let caps = CapabilityInfo {
        max_connections: config.max_connections,
        max_bandwidth_mbps: config.bandwidth_limit_mbps,
        available_ports: config.allowed_ports.clone(),
        connection_type: config.connection_type.clone(),
        uplink_speed_kbps: config.bandwidth_limit_mbps * 1000 / 2,
        downlink_speed_kbps: config.bandwidth_limit_mbps * 1000,
        cpu_cores: system.num_cpus.min(u32::MAX as usize) as u32,
        memory_mb: system.total_memory_mb.min(u64::from(u32::MAX)) as u32,
        os: std::env::consts::OS.to_string(),
        client_version: env!("CARGO_PKG_VERSION").to_string(),
        features: features.clone(),
        provider_lease: String::new(),
    };

    let lease_request = crate::ip::ProviderLeaseRequest {
        connection_type: caps.connection_type.clone(),
        available_ports: caps.available_ports.clone(),
        max_connections: caps.max_connections,
        max_bandwidth_mbps: caps.max_bandwidth_mbps,
        uplink_speed_kbps: caps.uplink_speed_kbps,
        downlink_speed_kbps: caps.downlink_speed_kbps,
        cpu_cores: caps.cpu_cores,
        memory_mb: caps.memory_mb,
        os: caps.os.clone(),
        client_version: caps.client_version.clone(),
        features,
    };

    (caps, lease_request)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode_segment(bytes: &[u8]) -> String {
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    }

    fn build_token(payload: serde_json::Value) -> String {
        let header = encode_segment(br#"{"alg":"HS256","typ":"JWT"}"#);
        let payload = encode_segment(payload.to_string().as_bytes());
        format!("{header}.{payload}.signature")
    }

    #[test]
    fn resolves_runtime_node_id_from_user_id_claim() {
        let token = build_token(serde_json::json!({
            "user_id": "41b97a34-c744-4b3e-99eb-09fa5652a374",
            "sub": "ignored-sub"
        }));

        let provider_user_id = resolve_runtime_provider_user_id(&token);
        let node_id = resolve_runtime_node_id(&Config::default(), provider_user_id).unwrap();

        assert_eq!(node_id, "node_41b97a34-c744-4b3e-99eb-09fa5652a374");
    }

    #[test]
    fn falls_back_to_sub_when_user_id_missing() {
        let token = build_token(serde_json::json!({
            "sub": "41b97a34-c744-4b3e-99eb-09fa5652a374"
        }));

        assert_eq!(
            resolve_runtime_provider_user_id(&token).as_deref(),
            Some("41b97a34-c744-4b3e-99eb-09fa5652a374")
        );
    }
}
