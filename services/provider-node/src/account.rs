//! `provider-node account --json`: what ProxyHubb's servers say about this computer and its
//! owner's earnings. The desktop app (apps/provider-app) runs it every few minutes.
//!
//! The report never carries a credential or an IP address. `node_id` is the id of this
//! computer's row on the server (from provider.toml); the server's own list of nodes is reduced
//! to that one row plus two counts.
//!
//! The key is exchanged once per run (one `POST /v1/provider/gateway-token`) and the token is used
//! for both requests, so a caller that polls pays for one exchange, not two.

use crate::config::Config;
use crate::operator::{self, EarningsSummary};
use crate::status::{self, ControlNodeSummary};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

/// A run that has not finished by now is abandoned: the requests below set no timeout of their
/// own, and a caller must never wait on a hung server.
const DEADLINE: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccountReport {
    /// This computer's node id from provider.toml; empty when the config has none.
    pub node_id: String,
    /// The servers answered the request for the account's nodes.
    pub reachable: bool,
    /// The servers refused this computer's key. Reconnecting cannot work until it is replaced.
    pub auth_rejected: bool,
    pub error: Option<String>,
    /// This computer's row on the server, when it is there.
    pub node: Option<AccountNode>,
    /// How many nodes the account has, and how many of them the server shows as online.
    pub nodes_total: u32,
    pub nodes_online: u32,
    pub earnings: Option<EarningsSummary>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccountNode {
    /// The server's status word for the node ("online", "offline", ...).
    pub status: String,
    pub is_healthy: bool,
    pub heartbeat_verified: bool,
}

/// Put the pieces into a report. Pure: every branch is tested without a network.
///
/// `bearer` is the outcome of exchanging the key (`Err` holds the message), `nodes` the outcome
/// of listing the account's nodes with it.
pub fn build_report(
    node_id: &str,
    bearer: Result<(), String>,
    nodes: Result<Vec<ControlNodeSummary>, String>,
    earnings: Option<EarningsSummary>,
) -> AccountReport {
    let mut report = AccountReport {
        node_id: node_id.to_string(),
        reachable: false,
        auth_rejected: false,
        error: None,
        node: None,
        nodes_total: 0,
        nodes_online: 0,
        earnings,
    };
    if let Err(message) = bearer {
        report.auth_rejected = key_was_refused(&message);
        report.error = Some(message);
        return report;
    }
    match nodes {
        Ok(list) => {
            report.reachable = true;
            report.nodes_total = list.len() as u32;
            report.nodes_online = list.iter().filter(|n| is_online(&n.status)).count() as u32;
            if !node_id.is_empty() {
                report.node = list.iter().find(|n| n.id == node_id).map(|n| AccountNode {
                    status: n.status.clone(),
                    is_healthy: n.is_healthy,
                    heartbeat_verified: n.latest_heartbeat_verified,
                });
            }
        }
        Err(message) => report.error = Some(message),
    }
    report
}

/// Did the server refuse the key (as opposed to being unreachable or failing)?
///
/// The phrases are specific to a refusal on purpose. Do not add the bare word "token": the node's
/// own error text ends with advice that always says it ("Create a fresh token in Dashboard..."),
/// so a 502 during a deploy would read as a revoked key (`main.rs`'s
/// `is_fatal_provider_auth_error` has that problem). The tests with the real message shape pin it.
fn key_was_refused(message: &str) -> bool {
    let said = message.to_ascii_lowercase();
    said.contains("invalid or inactive provider token")
        || said.contains("provider token expired")
        || said.contains("unauthorized")
        || said.contains("http 401")
        || said.contains("http 403")
}

fn is_online(status: &str) -> bool {
    status.trim().eq_ignore_ascii_case("online")
}

pub async fn collect(config_path: PathBuf) -> AccountReport {
    let cfg = Config::load(&config_path.to_string_lossy()).unwrap_or_default();
    match tokio::time::timeout(DEADLINE, collect_with(&cfg)).await {
        Ok(report) => report,
        Err(_) => build_report(
            &cfg.node_id,
            Ok(()),
            Err("ProxyHubb did not answer in time".to_string()),
            None,
        ),
    }
}

async fn collect_with(cfg: &Config) -> AccountReport {
    let api_url = cfg.control_api_url.trim_end_matches('/').to_string();
    let bearer = match status::resolve_control_bearer(cfg).await {
        Ok((_user_id, bearer)) => bearer,
        Err(e) => return build_report(&cfg.node_id, Err(format!("{e:#}")), Ok(Vec::new()), None),
    };
    let (nodes, earnings) = tokio::join!(
        status::fetch_control_nodes(&api_url, &bearer),
        operator::fetch_earnings_with(&api_url, &bearer),
    );
    build_report(
        &cfg.node_id,
        Ok(()),
        nodes.map_err(|e| format!("{e:#}")),
        earnings,
    )
}

pub fn print_human(report: &AccountReport) {
    println!("--- ProxyHubb account view ---");
    if report.auth_rejected {
        println!("The key in provider.toml was refused. Connect this computer again.");
    } else if !report.reachable {
        println!(
            "Could not ask ProxyHubb: {}",
            report.error.as_deref().unwrap_or("no answer")
        );
    } else {
        match &report.node {
            Some(n) => println!("This computer: {} (healthy: {})", n.status, n.is_healthy),
            None => println!("This computer is not listed on your account."),
        }
        println!(
            "Nodes online: {} of {}",
            report.nodes_online, report.nodes_total
        );
    }
    if let Some(e) = &report.earnings {
        println!(
            "Earnings (SOL): 7 days {:.4}, 30 days {:.4}, pending {:.4}, paid {:.4}",
            e.last_7_days_sol, e.last_30_days_sol, e.pending_sol, e.paid_sol
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn row(id: &str, status: &str) -> ControlNodeSummary {
        ControlNodeSummary {
            id: id.into(),
            name: "n".into(),
            status: status.into(),
            gateway_node_id: "gw".into(),
            ip_address: "203.0.113.9".into(),
            is_healthy: status == "online",
            latest_heartbeat_verified: true,
            latest_heartbeat_verification_error: String::new(),
            latest_heartbeat_signer: String::new(),
            hotkey: String::new(),
        }
    }

    fn earnings() -> EarningsSummary {
        EarningsSummary {
            total_earned_sol: 1.5,
            pending_sol: 0.25,
            paid_sol: 1.0,
            last_7_days_sol: 0.1,
            last_30_days_sol: 0.4,
            total_sessions: 12,
            total_bandwidth_gb: 3.5,
        }
    }

    #[test]
    fn this_computers_row_is_picked_out_of_the_accounts_nodes() {
        let r = build_report(
            "b",
            Ok(()),
            Ok(vec![
                row("a", "offline"),
                row("b", "online"),
                row("c", "online"),
            ]),
            Some(earnings()),
        );
        assert!(r.reachable && !r.auth_rejected);
        let node = r.node.expect("row b");
        assert_eq!(node.status, "online");
        assert!(node.is_healthy && node.heartbeat_verified);
        assert_eq!((r.nodes_total, r.nodes_online), (3, 2));
        assert_eq!(r.earnings, Some(earnings()));
    }

    #[test]
    fn a_computer_the_server_does_not_list_has_no_node() {
        let r = build_report("zzz", Ok(()), Ok(vec![row("a", "online")]), None);
        assert!(r.reachable);
        assert_eq!(r.node, None);
        // An empty node id in the config must never match some row by accident.
        let r = build_report("", Ok(()), Ok(vec![row("", "online")]), None);
        assert_eq!(r.node, None);
    }

    #[test]
    fn the_online_word_is_matched_without_regard_to_case_or_padding() {
        let r = build_report("a", Ok(()), Ok(vec![row("a", " Online ")]), None);
        assert_eq!(r.nodes_online, 1);
    }

    /// What `ip::exchange_gateway_token` really says: the server's words, then fixed advice that
    /// itself contains the word "token".
    fn exchange_failure(server_said: &str) -> String {
        format!(
            "Authentication failed: {server_said}. Create a fresh token in Dashboard → Provider → \
             Connect, paste the install script, or run: provider-node join --force --api-key <token>"
        )
    }

    #[test]
    fn a_refused_key_is_reported_as_such_and_not_as_an_outage() {
        for said in [
            "invalid or inactive provider token",
            "provider token expired",
            "HTTP 401 Unauthorized",
            "HTTP 403 Forbidden",
        ] {
            let msg = exchange_failure(said);
            let r = build_report("a", Err(msg.clone()), Ok(Vec::new()), None);
            assert!(r.auth_rejected && !r.reachable, "{said}");
            assert_eq!(r.error.as_deref(), Some(msg.as_str()));
        }
    }

    #[test]
    fn a_server_error_or_no_network_is_not_a_refused_key() {
        for msg in [
            "Failed to connect to Control API".to_string(),
            "config has no api_key or jwt_token for Control API".to_string(),
            // The trap: the advice after the server's words says "token" even for an outage.
            exchange_failure("HTTP 502 Bad Gateway"),
            exchange_failure("HTTP 500 Internal Server Error"),
            exchange_failure("HTTP 429 Too Many Requests"),
        ] {
            let r = build_report("a", Err(msg.clone()), Ok(Vec::new()), None);
            assert!(!r.auth_rejected && !r.reachable, "{msg}");
        }
    }

    #[test]
    fn a_failed_node_list_keeps_the_earnings_and_says_why() {
        let r = build_report(
            "a",
            Ok(()),
            Err("GET /v1/provider/nodes HTTP 500".into()),
            Some(earnings()),
        );
        assert!(!r.reachable && !r.auth_rejected);
        assert_eq!(r.node, None);
        assert!(r.earnings.is_some());
        assert!(r.error.is_some());
    }

    /// The desktop app (apps/provider-app, src-tauri/src/node.rs) reads exactly these paths.
    /// If this fails because a field moved or was renamed, update the app in the same change.
    #[test]
    fn account_json_keeps_the_fields_the_desktop_app_reads() {
        let r = build_report("b", Ok(()), Ok(vec![row("b", "online")]), Some(earnings()));
        let v: Value = serde_json::to_value(&r).unwrap();
        assert_eq!(v["node_id"], "b");
        assert_eq!(v["reachable"], true);
        assert_eq!(v["auth_rejected"], false);
        assert_eq!(v["nodes_total"], 1);
        assert_eq!(v["nodes_online"], 1);
        assert_eq!(
            v.pointer("/node/status").and_then(Value::as_str),
            Some("online")
        );
        assert_eq!(
            v.pointer("/node/is_healthy").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            v.pointer("/node/heartbeat_verified")
                .and_then(Value::as_bool),
            Some(true)
        );
        for path in [
            "/earnings/last_7_days_sol",
            "/earnings/last_30_days_sol",
            "/earnings/pending_sol",
            "/earnings/paid_sol",
            "/earnings/total_earned_sol",
        ] {
            assert!(v.pointer(path).and_then(Value::as_f64).is_some(), "{path}");
        }
    }

    /// The report goes to a window and may be pasted into a support request: no address of any
    /// node, and nothing that looks like a credential.
    #[test]
    fn the_report_carries_no_ip_address_and_no_credential() {
        let r = build_report("b", Ok(()), Ok(vec![row("b", "online")]), Some(earnings()));
        let text = serde_json::to_string(&r).unwrap();
        for forbidden in [
            "ip_address",
            "203.0.113.9",
            "api_key",
            "jwt",
            "signing",
            "hotkey",
        ] {
            assert!(!text.contains(forbidden), "{forbidden} in {text}");
        }
    }
}
