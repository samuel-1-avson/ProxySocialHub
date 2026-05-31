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

/// Create TLS acceptor for server-side TLS
pub fn create_tls_acceptor(
    config: &TlsConfig,
) -> Result<TlsAcceptor, Box<dyn std::error::Error + Send + Sync>> {
    let certs = load_certs(&config.cert_path)?;
    let key = load_key(&config.key_path)?;

    let server_config = if config.require_client_cert && config.ca_path.is_some() {
        // mTLS: Require client certificate
        let ca_path = config.ca_path.as_ref().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "CA path required for mTLS",
            )
        })?;
        let root_store = load_root_certs(ca_path)?;

        let client_verifier = WebPkiClientVerifier::builder(Arc::new(root_store)).build()?;

        ServerConfig::builder()
            .with_client_cert_verifier(client_verifier)
            .with_single_cert(certs, key)?
    } else {
        // Standard TLS (no client cert required)
        ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(certs, key)?
    };

    Ok(TlsAcceptor::from(Arc::new(server_config)))
}

/// Check if TLS is enabled
pub fn is_tls_enabled() -> bool {
    TlsConfig::from_env().is_some()
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
}
