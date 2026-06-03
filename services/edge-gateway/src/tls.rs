use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::Arc;

use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::server::WebPkiClientVerifier;
use rustls::{RootCertStore, ServerConfig};
use tokio_rustls::TlsAcceptor;

/// TLS configuration for the tunnel server
pub struct TlsConfig {
    pub cert_path: String,
    pub key_path: String,
    pub ca_path: Option<String>,
    pub require_client_cert: bool,
}

fn tls_env_path(primary: &str, legacy: &str) -> Option<String> {
    std::env::var(primary)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var(legacy)
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
}

impl TlsConfig {
    pub fn from_env() -> Option<Self> {
        let cert_path = tls_env_path("TLS_CERT_FILE", "TLS_CERT_PATH")?;
        let key_path = tls_env_path("TLS_KEY_FILE", "TLS_KEY_PATH")?;
        let ca_path = std::env::var("TLS_CA_FILE").ok();
        let require_client_cert = std::env::var("TLS_REQUIRE_CLIENT_CERT")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

        Some(Self {
            cert_path,
            key_path,
            ca_path,
            require_client_cert,
        })
    }
}

/// Load certificates from PEM file
fn load_certs(
    path: &str,
) -> Result<Vec<CertificateDer<'static>>, Box<dyn std::error::Error + Send + Sync>> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let certs = rustls_pemfile::certs(&mut reader).collect::<Result<Vec<_>, _>>()?;
    Ok(certs)
}

/// Load private key from PEM file
fn load_key(
    path: &str,
) -> Result<PrivateKeyDer<'static>, Box<dyn std::error::Error + Send + Sync>> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);

    // Try to load RSA key first, then EC key
    let keys = rustls_pemfile::private_key(&mut reader)?.ok_or("No private key found")?;

    Ok(keys)
}

/// Load CA certificates for client verification
fn load_root_certs(path: &str) -> Result<RootCertStore, Box<dyn std::error::Error + Send + Sync>> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let certs = rustls_pemfile::certs(&mut reader).collect::<Result<Vec<_>, _>>()?;

    let mut root_store = RootCertStore::empty();
    for cert in certs {
        root_store.add(cert)?;
    }

    Ok(root_store)
}

fn env_bool(key: &str, default: bool) -> bool {
    std::env::var(key)
        .ok()
        .and_then(|value| match value.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Some(true),
            "0" | "false" | "no" | "off" => Some(false),
            _ => None,
        })
        .unwrap_or(default)
}

/// TLS config for the buyer proxy port when `BUYER_TLS_ENABLE` is set and cert/key paths resolve.
pub fn buyer_tls_config_from_env() -> Option<TlsConfig> {
    if !env_bool("BUYER_TLS_ENABLE", false) {
        return None;
    }
    let cert_path = tls_env_path("BUYER_TLS_CERT_FILE", "BUYER_TLS_CERT_PATH")
        .or_else(|| tls_env_path("TLS_CERT_FILE", "TLS_CERT_PATH"))?;
    let key_path = tls_env_path("BUYER_TLS_KEY_FILE", "BUYER_TLS_KEY_PATH")
        .or_else(|| tls_env_path("TLS_KEY_FILE", "TLS_KEY_PATH"))?;
    Some(TlsConfig {
        cert_path,
        key_path,
        ca_path: None,
        require_client_cert: false,
    })
}

#[cfg(feature = "quic")]
pub fn http3_tls_config_from_env() -> Option<TlsConfig> {
    if !env_bool("ENABLE_HTTP3_INGRESS", false) {
        return None;
    }
    let cert_path = tls_env_path("HTTP3_TLS_CERT_FILE", "HTTP3_TLS_CERT_PATH")
        .or_else(|| tls_env_path("BUYER_TLS_CERT_FILE", "BUYER_TLS_CERT_PATH"))
        .or_else(|| tls_env_path("TLS_CERT_FILE", "TLS_CERT_PATH"))?;
    let key_path = tls_env_path("HTTP3_TLS_KEY_FILE", "HTTP3_TLS_KEY_PATH")
        .or_else(|| tls_env_path("BUYER_TLS_KEY_FILE", "BUYER_TLS_KEY_PATH"))
        .or_else(|| tls_env_path("TLS_KEY_FILE", "TLS_KEY_PATH"))?;
    Some(TlsConfig {
        cert_path,
        key_path,
        ca_path: None,
        require_client_cert: false,
    })
}

fn apply_buyer_server_tuning(server_config: &mut ServerConfig) {
    use rustls::server::ServerSessionMemoryCache;
    server_config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    server_config.session_storage = ServerSessionMemoryCache::new(256);
}

fn apply_http3_server_tuning(server_config: &mut ServerConfig) {
    server_config.alpn_protocols = vec![b"h3".to_vec()];
}

fn build_server_config(
    config: &TlsConfig,
) -> Result<ServerConfig, Box<dyn std::error::Error + Send + Sync>> {
    let certs = load_certs(&config.cert_path)?;
    let key = load_key(&config.key_path)?;

    if config.require_client_cert && config.ca_path.is_some() {
        let ca_path = config.ca_path.as_ref().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "CA path required for mTLS",
            )
        })?;
        let root_store = load_root_certs(ca_path)?;
        let client_verifier = WebPkiClientVerifier::builder(Arc::new(root_store)).build()?;
        Ok(ServerConfig::builder()
            .with_client_cert_verifier(client_verifier)
            .with_single_cert(certs, key)?)
    } else {
        Ok(ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(certs, key)?)
    }
}

/// Create TLS acceptor for the provider tunnel (yamux over TLS; no HTTP ALPN).
pub fn create_tls_acceptor(
    config: &TlsConfig,
) -> Result<TlsAcceptor, Box<dyn std::error::Error + Send + Sync>> {
    let server_config = build_server_config(config)?;
    Ok(TlsAcceptor::from(Arc::new(server_config)))
}

/// Buyer ingress TLS: ALPN `h2` + `http/1.1` and in-memory session resumption.
pub fn create_buyer_tls_acceptor(
    config: &TlsConfig,
) -> Result<TlsAcceptor, Box<dyn std::error::Error + Send + Sync>> {
    let mut server_config = build_server_config(config)?;
    apply_buyer_server_tuning(&mut server_config);
    Ok(TlsAcceptor::from(Arc::new(server_config)))
}

/// QUIC server config for the provider tunnel (yamux over QUIC; not HTTP/3 ALPN).
#[cfg(feature = "quic")]
pub fn create_provider_quic_server_config(
    config: &TlsConfig,
) -> Result<quinn::ServerConfig, Box<dyn std::error::Error + Send + Sync>> {
    let rustls_config = build_server_config(config)?;
    let quic_crypto = quinn::crypto::rustls::QuicServerConfig::try_from(rustls_config)?;
    let mut server_config = quinn::ServerConfig::with_crypto(Arc::new(quic_crypto));
    let mut transport = quinn::TransportConfig::default();
    transport.max_concurrent_bidi_streams(256_u32.into());
    transport.keep_alive_interval(Some(std::time::Duration::from_secs(10)));
    server_config.transport = Arc::new(transport);
    Ok(server_config)
}

#[cfg(feature = "quic")]
pub fn create_http3_quic_server_config(
    config: &TlsConfig,
) -> Result<quinn::ServerConfig, Box<dyn std::error::Error + Send + Sync>> {
    let mut rustls_config = build_server_config(config)?;
    apply_http3_server_tuning(&mut rustls_config);
    rustls_config.max_early_data_size = u32::MAX;

    let quic_crypto = quinn::crypto::rustls::QuicServerConfig::try_from(rustls_config)?;
    let mut server_config = quinn::ServerConfig::with_crypto(Arc::new(quic_crypto));
    let mut transport = quinn::TransportConfig::default();
    transport.max_concurrent_bidi_streams(1024_u32.into());
    server_config.transport = Arc::new(transport);
    Ok(server_config)
}

/// Check if TLS is enabled on the provider tunnel listener.
pub fn is_tls_enabled() -> bool {
    TlsConfig::from_env().is_some()
}

/// Check if TLS is enabled on the buyer proxy port (`BUYER_TLS_ENABLE` + cert/key paths).
pub fn is_buyer_tls_enabled() -> bool {
    buyer_tls_config_from_env().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env lock")
    }

    #[test]
    fn tls_from_env_accepts_legacy_cert_path_names() {
        let _guard = env_lock();
        let keys = [
            "TLS_CERT_FILE",
            "TLS_KEY_FILE",
            "TLS_CERT_PATH",
            "TLS_KEY_PATH",
            "TLS_CA_FILE",
        ];
        let previous: Vec<_> = keys.iter().map(|key| std::env::var(key).ok()).collect();
        for key in &keys {
            std::env::remove_var(key);
        }

        std::env::set_var("TLS_CERT_PATH", "/tmp/cert.pem");
        std::env::set_var("TLS_KEY_PATH", "/tmp/key.pem");
        let cfg = TlsConfig::from_env().expect("legacy TLS env names should enable TLS");
        assert_eq!(cfg.cert_path, "/tmp/cert.pem");
        assert_eq!(cfg.key_path, "/tmp/key.pem");
        assert!(is_tls_enabled());

        for (key, value) in keys.iter().zip(previous.iter()) {
            match value {
                Some(v) => std::env::set_var(key, v),
                None => std::env::remove_var(key),
            }
        }
    }

    #[test]
    fn buyer_tls_requires_explicit_enable() {
        let _guard = env_lock();
        let keys = [
            "BUYER_TLS_ENABLE",
            "BUYER_TLS_CERT_FILE",
            "BUYER_TLS_KEY_FILE",
            "TLS_CERT_FILE",
            "TLS_KEY_FILE",
        ];
        let previous: Vec<_> = keys.iter().map(|key| std::env::var(key).ok()).collect();
        for key in &keys {
            std::env::remove_var(key);
        }
        std::env::set_var("TLS_CERT_FILE", "/tmp/cert.pem");
        std::env::set_var("TLS_KEY_FILE", "/tmp/key.pem");
        assert!(buyer_tls_config_from_env().is_none());

        std::env::set_var("BUYER_TLS_ENABLE", "true");
        let cfg = buyer_tls_config_from_env().expect("enabled buyer TLS should resolve certs");
        assert_eq!(cfg.cert_path, "/tmp/cert.pem");
        assert_eq!(cfg.key_path, "/tmp/key.pem");

        for (key, value) in keys.iter().zip(previous.iter()) {
            match value {
                Some(v) => std::env::set_var(key, v),
                None => std::env::remove_var(key),
            }
        }
    }
}
