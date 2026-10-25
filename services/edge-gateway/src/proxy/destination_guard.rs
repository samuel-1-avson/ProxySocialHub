//! Destination checks every buyer-facing tunnel must pass before a provider is contacted.
//!
//! The HTTP CONNECT path in `main.rs` runs these inline. The WebSocket bridge did not run
//! them at all (DP-CRIT-01), so a buyer could open `?target=` to a forbidden port or a
//! private address and move traffic that was neither policy-checked nor metered. These
//! functions carry the same decisions, status codes, bodies and metric labels as the
//! CONNECT path so the WebSocket handler can share them. Moving CONNECT onto them, and the
//! rest of the pipeline (SOCKS5, HTTP/3), is the Phase 4 unification in the implementation
//! plan.

use bytes::Bytes;
use http_body_util::Full;
use hyper::{header::HeaderValue, Response, StatusCode};

use crate::auth::{NodeConfig, SessionData};
use crate::{metrics, policy};

/// A reason a buyer connection to `addr` is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal {
    pub status: StatusCode,
    pub body: &'static str,
    /// Label for the policy-block counter when this is a policy decision.
    pub policy_block: Option<String>,
    /// Label for the auth-failure counter when this is a session problem.
    pub auth_failure: Option<&'static str>,
}

impl Refusal {
    /// A refusal that is not a policy or auth decision (rate limits, no providers).
    pub fn plain(status: StatusCode, body: &'static str) -> Self {
        Self {
            status,
            body,
            policy_block: None,
            auth_failure: None,
        }
    }

    fn policy(body: &'static str, reason: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            body,
            policy_block: Some(reason.into()),
            auth_failure: None,
        }
    }

    /// Increment the same counters the CONNECT path increments.
    pub fn record(&self) {
        if let Some(reason) = &self.policy_block {
            metrics::record_policy_block(reason);
        }
        if let Some(reason) = self.auth_failure {
            metrics::record_auth_failure(reason);
        }
    }

    pub fn into_response(self) -> Response<Full<Bytes>> {
        let mut resp = Response::new(Full::new(Bytes::from_static(self.body.as_bytes())));
        *resp.status_mut() = self.status;
        if self.status == StatusCode::PROXY_AUTHENTICATION_REQUIRED {
            resp.headers_mut().insert(
                "Proxy-Authenticate",
                HeaderValue::from_static("Basic realm=\"ProxyHub\""),
            );
        }
        resp
    }
}

/// Port whitelist, private and reserved addresses, and internal hostnames.
pub fn check_destination(addr: &str) -> Result<(), Refusal> {
    policy::validate_destination(addr)
        .map_err(|reason| Refusal::policy("Destination blocked by policy", reason))
}

/// GW-07 DNS-rebinding check, when `GATEWAY_DNS_REBIND_CHECK` is on.
pub async fn check_destination_dns(addr: &str) -> Result<(), Refusal> {
    policy::validate_destination_dns(addr)
        .await
        .map_err(|reason| Refusal::policy("Destination blocked by policy", reason))
}

/// N-02 session rules: blocked domains win over the allowlist, then the session time limit.
pub fn check_session_rules(addr: &str, session: &SessionData) -> Result<(), Refusal> {
    let host = policy::target_host_from_endpoint(addr);

    if policy::host_matches_any_domain_rule(host, &session.blocked_domains) {
        return Err(Refusal::policy(
            "Destination blocked by session policy",
            "session_blocked_domain",
        ));
    }
    if !session.allowed_domains.is_empty()
        && !policy::host_matches_any_domain_rule(host, &session.allowed_domains)
    {
        return Err(Refusal::policy(
            "Destination not in session allowlist",
            "session_domain_not_whitelisted",
        ));
    }
    if !session.session_within_time_limit() {
        return Err(Refusal {
            status: StatusCode::PROXY_AUTHENTICATION_REQUIRED,
            body: "Proxy session expired (time limit reached)",
            policy_block: None,
            auth_failure: Some("session_time_limit"),
        });
    }
    Ok(())
}

/// N-01 provider-node rules: blocked ports, the port allowlist, blocked domains and the
/// domain allowlist, checked once a node has been chosen.
pub fn check_node_rules(addr: &str, cfg: &NodeConfig) -> Result<(), Refusal> {
    let host = policy::target_host_from_endpoint(addr);
    let port = policy::parse_port(addr).map(i64::from).unwrap_or(443);

    if cfg.blocked_ports.contains(&port) {
        return Err(Refusal::policy(
            "Destination port blocked by provider policy",
            "node_blocked_port",
        ));
    }
    if !cfg.allowed_ports.is_empty() && !cfg.allowed_ports.contains(&port) {
        return Err(Refusal::policy(
            "Destination port not allowed by provider policy",
            "node_port_not_whitelisted",
        ));
    }
    if policy::host_matches_any_domain_rule(host, &cfg.blocked_domains) {
        return Err(Refusal::policy(
            "Destination domain blocked by provider policy",
            "node_blocked_domain",
        ));
    }
    if !cfg.allowed_domains.is_empty()
        && !policy::host_matches_any_domain_rule(host, &cfg.allowed_domains)
    {
        return Err(Refusal::policy(
            "Destination domain not allowed by provider policy",
            "node_domain_not_whitelisted",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, Utc};

    fn blocked(addr: &str) -> bool {
        match check_destination(addr) {
            Err(r) => {
                assert_eq!(r.status, StatusCode::FORBIDDEN, "{addr}");
                assert_eq!(r.body, "Destination blocked by policy", "{addr}");
                true
            }
            Ok(()) => false,
        }
    }

    // DP-CRIT-01: the WebSocket bridge used `?target=` unchecked.
    #[test]
    fn refuses_private_and_internal_targets() {
        for addr in [
            "127.0.0.1:8080",
            "10.0.0.5:443",
            "192.168.1.1:80",
            "169.254.169.254:80",
            "[::1]:443",
            "[::ffff:127.0.0.1]:443",
            "[::ffff:169.254.169.254]:80",
            "localhost:80",
            "metadata.google.internal:80",
            "printer.local:80",
        ] {
            assert!(blocked(addr), "{addr} must be refused");
        }
    }

    #[test]
    fn refuses_ports_outside_the_whitelist() {
        assert!(blocked("example.com:25565"));
        assert!(blocked("203.0.113.9:6379"));
    }

    #[test]
    fn allows_ordinary_public_targets() {
        for addr in [
            "example.com:443",
            "93.184.216.34:80",
            "[2606:4700:4700::1111]:443",
        ] {
            assert!(check_destination(addr).is_ok(), "{addr} should pass");
        }
    }

    fn session() -> SessionData {
        SessionData::default()
    }

    #[test]
    fn session_blocklist_wins_over_allowlist() {
        let mut s = session();
        s.allowed_domains = vec!["example.com".into()];
        s.blocked_domains = vec!["www.example.com".into()];
        let r = check_session_rules("www.example.com:443", &s).unwrap_err();
        assert_eq!(r.body, "Destination blocked by session policy");
        assert_eq!(r.policy_block.as_deref(), Some("session_blocked_domain"));
    }

    #[test]
    fn session_allowlist_limits_destinations_when_set() {
        let mut s = session();
        s.allowed_domains = vec!["example.com".into()];
        assert!(check_session_rules("api.example.com:443", &s).is_ok());
        let r = check_session_rules("other.org:443", &s).unwrap_err();
        assert_eq!(r.status, StatusCode::FORBIDDEN);
        assert_eq!(
            r.policy_block.as_deref(),
            Some("session_domain_not_whitelisted")
        );
        // No allowlist: anything not blocked is fine.
        assert!(check_session_rules("other.org:443", &session()).is_ok());
    }

    #[test]
    fn expired_session_is_a_407_with_the_auth_failure_label() {
        let mut s = session();
        s.expires_at = Some(Utc::now() - Duration::minutes(5));
        let r = check_session_rules("example.com:443", &s).unwrap_err();
        assert_eq!(r.status, StatusCode::PROXY_AUTHENTICATION_REQUIRED);
        assert_eq!(r.auth_failure, Some("session_time_limit"));
        assert!(r.policy_block.is_none());

        let resp = r.into_response();
        assert_eq!(resp.status(), StatusCode::PROXY_AUTHENTICATION_REQUIRED);
        assert!(resp.headers().contains_key("Proxy-Authenticate"));
    }

    fn node(f: impl FnOnce(&mut NodeConfig)) -> NodeConfig {
        let mut cfg: NodeConfig = serde_json::from_str("{}").expect("empty node config");
        f(&mut cfg);
        cfg
    }

    #[test]
    fn node_rules_cover_ports_and_domains() {
        let open = node(|_| {});
        assert!(check_node_rules("example.com:443", &open).is_ok());

        let c = node(|c| c.blocked_ports = vec![443]);
        assert_eq!(
            check_node_rules("example.com:443", &c)
                .unwrap_err()
                .policy_block
                .as_deref(),
            Some("node_blocked_port")
        );

        let c = node(|c| c.allowed_ports = vec![80]);
        assert!(check_node_rules("example.com:80", &c).is_ok());
        assert_eq!(
            check_node_rules("example.com:443", &c)
                .unwrap_err()
                .policy_block
                .as_deref(),
            Some("node_port_not_whitelisted")
        );

        let c = node(|c| c.blocked_domains = vec!["bad.com".into()]);
        assert_eq!(
            check_node_rules("x.bad.com:443", &c)
                .unwrap_err()
                .policy_block
                .as_deref(),
            Some("node_blocked_domain")
        );

        let c = node(|c| c.allowed_domains = vec!["good.com".into()]);
        assert!(check_node_rules("good.com:443", &c).is_ok());
        assert_eq!(
            check_node_rules("other.com:443", &c)
                .unwrap_err()
                .policy_block
                .as_deref(),
            Some("node_domain_not_whitelisted")
        );
    }

    #[test]
    fn node_port_defaults_to_443_when_the_target_has_none() {
        let c = node(|c| c.blocked_ports = vec![443]);
        assert!(check_node_rules("example.com", &c).is_err());
    }
}
