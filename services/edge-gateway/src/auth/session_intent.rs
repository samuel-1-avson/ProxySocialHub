use crate::error::{Error, Result};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

const ISSUER: &str = "proxyhubb-control-api";
const AUDIENCE: &str = "proxyhubb-edge-gateway";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionIntentClaims {
    pub sub: String,
    #[serde(default)]
    pub listing_id: String,
    pub session_type: String,
    pub trust_tier: String,
    pub bandwidth_limit: i64,
    #[serde(default)]
    pub target_geo: String,
    #[serde(default)]
    pub target_isp: String,
    #[serde(default)]
    pub routing_profile: String,
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    #[serde(default)]
    pub blocked_domains: Vec<String>,
    #[serde(default)]
    pub rotation_type: String,
    #[serde(default)]
    pub rotation_interval_seconds: i32,
    #[serde(default)]
    pub time_limit_minutes: i32,
    #[serde(default)]
    pub preferred_tier: String,
    pub requests_per_minute: i32,
    pub max_concurrency: i32,
    #[serde(default)]
    pub max_price_per_gb: f64,
    pub aud: String,
    pub exp: usize,
    pub iat: usize,
    pub iss: String,
    pub jti: String,
    pub nbf: usize,
}

pub struct SessionIntentValidator {
    secret: String,
}

impl SessionIntentValidator {
    pub fn new(secret: impl Into<String>) -> Self {
        Self {
            secret: secret.into(),
        }
    }

    pub fn validate(&self, token: &str) -> Result<SessionIntentClaims> {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_audience(&[AUDIENCE]);
        validation.set_issuer(&[ISSUER]);
        validation.validate_exp = true;
        validation.leeway = 5;

        let decoded = decode::<SessionIntentClaims>(
            token,
            &DecodingKey::from_secret(self.secret.as_bytes()),
            &validation,
        )
        .map_err(|err| Error::Authorization(format!("invalid session intent: {}", err)))?;

        Ok(decoded.claims)
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

    fn sample_claims(exp: usize) -> SessionIntentClaims {
        SessionIntentClaims {
            sub: "11111111-1111-1111-1111-111111111111".to_string(),
            listing_id: "listing-123".to_string(),
            session_type: "sticky".to_string(),
            trust_tier: "premium".to_string(),
            bandwidth_limit: 1024,
            target_geo: "US".to_string(),
            target_isp: "FiberCo".to_string(),
            routing_profile: "web-scraping".to_string(),
            allowed_domains: vec!["example.com".to_string()],
            blocked_domains: vec!["blocked.example".to_string()],
            rotation_type: "time-based".to_string(),
            rotation_interval_seconds: 60,
            time_limit_minutes: 15,
            preferred_tier: "Gold".to_string(),
            requests_per_minute: 1000,
            max_concurrency: 100,
            max_price_per_gb: 0.25,
            aud: AUDIENCE.to_string(),
            exp,
            iat: now(),
            iss: ISSUER.to_string(),
            jti: "intent-123".to_string(),
            nbf: now(),
        }
    }

    #[test]
    fn validates_well_formed_token() {
        let claims = sample_claims(now() + 60);
        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(b"shared-secret"),
        )
        .unwrap();

        let validator = SessionIntentValidator::new("shared-secret");
        let parsed = validator.validate(&token).unwrap();

        assert_eq!(parsed.sub, claims.sub);
        assert_eq!(parsed.session_type, "sticky");
        assert_eq!(parsed.requests_per_minute, 1000);
    }

    #[test]
    fn rejects_expired_token() {
        let claims = sample_claims(now().saturating_sub(10));
        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(b"shared-secret"),
        )
        .unwrap();

        let validator = SessionIntentValidator::new("shared-secret");
        assert!(validator.validate(&token).is_err());
    }
}