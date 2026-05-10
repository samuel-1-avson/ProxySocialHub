use crate::error::{Error, Result};
use crate::tunnel::ProviderCapabilities;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use std::env;

const ISSUER: &str = "proxyhubb-control-api";
const AUDIENCE: &str = "proxyhubb-edge-gateway-provider";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum AudienceClaim {
    One(String),
    Many(Vec<String>),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProviderLeaseClaims {
    pub sub: String,
    pub user_id: String,
    pub connection_type: String,
    pub available_ports: Vec<u16>,
    pub max_connections: u32,
    pub max_bandwidth_mbps: u32,
    pub uplink_speed_kbps: u32,
    pub downlink_speed_kbps: u32,
    pub cpu_cores: u32,
    pub memory_mb: u32,
    pub os: String,
    pub client_version: String,
    pub features: Vec<String>,
    pub aud: AudienceClaim,
    pub exp: usize,
    pub iat: usize,
    pub iss: String,
    pub jti: String,
    pub nbf: usize,
}

pub struct ProviderLeaseValidator {
    secret: String,
}

impl ProviderLeaseValidator {
    pub fn new(secret: impl Into<String>) -> Self {
        Self {
            secret: secret.into(),
        }
    }

    pub fn validate(
        &self,
        token: &str,
        expected_user_id: &str,
        caps: &ProviderCapabilities,
    ) -> Result<ProviderLeaseClaims> {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_audience(&[AUDIENCE]);
        validation.set_issuer(&[ISSUER]);
        validation.validate_exp = true;
        validation.leeway = 5;

        let decoded = decode::<ProviderLeaseClaims>(
            token,
            &DecodingKey::from_secret(self.secret.as_bytes()),
            &validation,
        )
        .map_err(|err| Error::Authorization(format!("invalid provider lease: {}", err)))?;

        let claims = decoded.claims;
        if claims.sub != expected_user_id || claims.user_id != expected_user_id {
            return Err(Error::Authorization(
                "provider lease subject does not match authenticated provider".to_string(),
            ));
        }
        if claims.connection_type != caps.connection_type
            || claims.max_connections != caps.max_connections
            || claims.max_bandwidth_mbps != caps.max_bandwidth_mbps
            || claims.available_ports != caps.available_ports
            || claims.client_version != caps.client_version
            || claims.features != caps.features
        {
            return Err(Error::Authorization(
                "provider lease does not match presented capabilities".to_string(),
            ));
        }

        Ok(claims)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn now() -> usize {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as usize
    }

    fn sample_caps() -> ProviderCapabilities {
        ProviderCapabilities {
            max_connections: 500,
            max_bandwidth_mbps: 100,
            available_ports: vec![80, 443],
            connection_type: "residential".to_string(),
            uplink_speed_kbps: 50000,
            downlink_speed_kbps: 100000,
            cpu_cores: 8,
            memory_mb: 16384,
            os: "linux".to_string(),
            client_version: "1.0.0".to_string(),
            features: vec!["ipv4".to_string(), "http_connect".to_string()],
            provider_lease: String::new(),
        }
    }

    fn sample_claims(exp: usize) -> ProviderLeaseClaims {
        let caps = sample_caps();
        ProviderLeaseClaims {
            sub: "provider-123".to_string(),
            user_id: "provider-123".to_string(),
            connection_type: caps.connection_type,
            available_ports: caps.available_ports,
            max_connections: caps.max_connections,
            max_bandwidth_mbps: caps.max_bandwidth_mbps,
            uplink_speed_kbps: caps.uplink_speed_kbps,
            downlink_speed_kbps: caps.downlink_speed_kbps,
            cpu_cores: caps.cpu_cores,
            memory_mb: caps.memory_mb,
            os: caps.os,
            client_version: caps.client_version,
            features: caps.features,
            aud: AudienceClaim::One(AUDIENCE.to_string()),
            exp,
            iat: now(),
            iss: ISSUER.to_string(),
            jti: "lease-123".to_string(),
            nbf: now(),
        }
    }

    #[test]
    fn validates_matching_provider_lease() {
        let claims = sample_claims(now() + 60);
        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(b"gateway-secret"),
        )
        .unwrap();

        let validator = ProviderLeaseValidator::new("gateway-secret");
        let parsed = validator.validate(&token, "provider-123", &sample_caps()).unwrap();

        assert_eq!(parsed.user_id, "provider-123");
    }

    #[test]
    fn validates_matching_provider_lease_with_array_audience() {
        let mut claims = sample_claims(now() + 60);
        claims.aud = AudienceClaim::Many(vec![AUDIENCE.to_string()]);

        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(b"gateway-secret"),
        )
        .unwrap();

        let validator = ProviderLeaseValidator::new("gateway-secret");
        let parsed = validator.validate(&token, "provider-123", &sample_caps()).unwrap();

        assert_eq!(parsed.user_id, "provider-123");
        assert_eq!(parsed.aud, claims.aud);
    }
}

pub fn provider_leases_required() -> bool {
    if let Ok(raw) = env::var("REQUIRE_PROVIDER_LEASE") {
        let value = raw.trim().to_ascii_lowercase();
        return matches!(value.as_str(), "1" | "true" | "yes" | "on");
    }

    for key in ["APP_ENV", "GO_ENV", "RUST_ENV", "ENVIRONMENT"] {
        if let Ok(raw) = env::var(key) {
            let value = raw.trim().to_ascii_lowercase();
            if matches!(value.as_str(), "development" | "dev" | "local" | "test") {
                return false;
            }
            return true;
        }
    }

    !cfg!(debug_assertions)
}

pub fn lease_is_fresh(expires_at_epoch: u64) -> bool {
    if expires_at_epoch == 0 {
        return false;
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    now <= expires_at_epoch
}