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

impl TlsConfig {
    pub fn from_env() -> Option<Self> {
        let cert_path = std::env::var("TLS_CERT_FILE").ok()?;
        let key_path = std::env::var("TLS_KEY_FILE").ok()?;
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
    std::env::var("TLS_CERT_FILE").is_ok() && std::env::var("TLS_KEY_FILE").is_ok()
}
