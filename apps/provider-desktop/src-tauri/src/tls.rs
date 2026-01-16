use std::fs::File;
use std::io::BufReader;
use std::sync::Arc;

use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::{RootCertStore, ClientConfig};
use tokio_rustls::TlsConnector;

pub struct TlsConfig {
    pub ca_path: String,
    pub cert_path: Option<String>,
    pub key_path: Option<String>,
}

impl TlsConfig {
    pub fn new(ca_path: &str, cert_path: Option<&str>, key_path: Option<&str>) -> Self {
        Self {
            ca_path: ca_path.to_string(),
            cert_path: cert_path.map(|s| s.to_string()),
            key_path: key_path.map(|s| s.to_string()),
        }
    }
}

fn load_certs(path: &str) -> Result<Vec<CertificateDer<'static>>, Box<dyn std::error::Error + Send + Sync>> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let certs = rustls_pemfile::certs(&mut reader)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(certs)
}

fn load_key(path: &str) -> Result<PrivateKeyDer<'static>, Box<dyn std::error::Error + Send + Sync>> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let keys = rustls_pemfile::private_key(&mut reader)?
        .ok_or("No private key found")?;
    Ok(keys)
}

fn load_root_certs(path: &str) -> Result<RootCertStore, Box<dyn std::error::Error + Send + Sync>> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let certs = rustls_pemfile::certs(&mut reader)
        .collect::<Result<Vec<_>, _>>()?;
    
    let mut root_store = RootCertStore::empty();
    for cert in certs {
        root_store.add(cert)?;
    }
    Ok(root_store)
}

pub fn create_tls_connector(config: &TlsConfig) -> Result<TlsConnector, Box<dyn std::error::Error + Send + Sync>> {
    let root_store = load_root_certs(&config.ca_path)?;

    let client_config = if let (Some(cert_path), Some(key_path)) = (&config.cert_path, &config.key_path) {
        // mTLS
        let certs = load_certs(cert_path)?;
        let key = load_key(key_path)?;
        
        ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_client_auth_cert(certs, key)?
    } else {
        // One-way TLS
        ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth()
    };

    Ok(TlsConnector::from(Arc::new(client_config)))
}
