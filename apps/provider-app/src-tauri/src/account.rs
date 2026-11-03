//! What ProxyHubb's servers say about this computer and its earnings: the parsing of
//! `provider-node account --json` and the plain views the window shows from it.
//!
//! Everything here is a pure function of text or values, tested without a node. The numbers come
//! from the servers and are shown as given, except that a value that cannot be a real amount
//! (negative, not finite) is shown as zero rather than as nonsense.

use serde::{Deserialize, Serialize};

/// The fields of the `account --json` report the app reads; `provider-node`'s
/// `account::tests::account_json_keeps_the_fields_the_desktop_app_reads` pins them.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct AccountFacts {
    #[serde(default)]
    pub reachable: bool,
    #[serde(default)]
    pub auth_rejected: bool,
    #[serde(default)]
    pub node: Option<ServerNode>,
    #[serde(default)]
    pub earnings: Option<EarningsFacts>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ServerNode {
    #[serde(default)]
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct EarningsFacts {
    #[serde(default)]
    pub last_7_days_sol: f64,
    #[serde(default)]
    pub last_30_days_sol: f64,
    #[serde(default)]
    pub pending_sol: f64,
    #[serde(default)]
    pub paid_sol: f64,
}

/// The facts and when they were fetched (seconds since the epoch), so the window can say how old
/// they are.
#[derive(Debug, Clone, PartialEq)]
pub struct AccountSnapshot {
    pub facts: AccountFacts,
    pub fetched_unix: u64,
}

/// Turn `provider-node account --json` output into facts. Tolerates anything printed before the
/// JSON object.
pub fn parse_account(text: &str) -> Result<AccountFacts, String> {
    first_json(text, "account")
}

/// The first JSON object in a command's output, with anything before or after it ignored.
/// `what` names the command in the error.
pub fn first_json<T: serde::de::DeserializeOwned>(text: &str, what: &str) -> Result<T, String> {
    let start = text
        .find('{')
        .ok_or_else(|| format!("provider-node {what} printed no JSON"))?;
    serde_json::Deserializer::from_str(&text[start..])
        .into_iter::<T>()
        .next()
        .ok_or_else(|| format!("provider-node {what} printed no JSON"))?
        .map_err(|e| format!("could not read provider-node {what}: {e}"))
}

/// What the server says about this computer, in terms the window can state plainly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerView {
    /// Nothing fetched yet.
    Checking,
    /// The server lists this computer as online.
    Online,
    /// The server lists this computer but not as online (often just after connecting).
    NotSeen,
    /// The server answered, but this computer is not among the account's nodes.
    NotRegistered,
    /// The server refused this computer's key.
    KeyRejected,
    /// The server could not be asked right now.
    Unreachable,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EarningsView {
    pub last_7_days_sol: f64,
    pub last_30_days_sol: f64,
    /// Earned and waiting to be paid out.
    pub pending_sol: f64,
    pub paid_sol: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RemoteView {
    pub server: ServerView,
    pub earnings: Option<EarningsView>,
    /// When this was fetched; `None` while `server` is `Checking`.
    pub updated_at_unix: Option<u64>,
}

impl Default for RemoteView {
    fn default() -> Self {
        RemoteView {
            server: ServerView::Checking,
            earnings: None,
            updated_at_unix: None,
        }
    }
}

fn server_view(facts: &AccountFacts) -> ServerView {
    if facts.auth_rejected {
        return ServerView::KeyRejected;
    }
    if !facts.reachable {
        return ServerView::Unreachable;
    }
    match &facts.node {
        None => ServerView::NotRegistered,
        Some(node) if node.status.trim().eq_ignore_ascii_case("online") => ServerView::Online,
        Some(_) => ServerView::NotSeen,
    }
}

/// An amount that cannot be real is shown as zero, not as a negative or a non-number.
fn clean(sol: f64) -> f64 {
    if sol.is_finite() && sol > 0.0 {
        sol
    } else {
        0.0
    }
}

pub fn remote_view(snapshot: Option<&AccountSnapshot>) -> RemoteView {
    let Some(snapshot) = snapshot else {
        return RemoteView::default();
    };
    RemoteView {
        server: server_view(&snapshot.facts),
        earnings: snapshot.facts.earnings.as_ref().map(|e| EarningsView {
            last_7_days_sol: clean(e.last_7_days_sol),
            last_30_days_sol: clean(e.last_30_days_sol),
            pending_sol: clean(e.pending_sol),
            paid_sol: clean(e.paid_sol),
        }),
        updated_at_unix: Some(snapshot.fetched_unix),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const REPORT: &str = r#"{
      "node_id": "b", "reachable": true, "auth_rejected": false, "error": null,
      "node": {"status": "online", "is_healthy": true, "heartbeat_verified": true},
      "nodes_total": 2, "nodes_online": 1,
      "earnings": {"total_earned_sol": 1.5, "pending_sol": 0.25, "paid_sol": 1.0,
                   "last_7_days_sol": 0.1, "last_30_days_sol": 0.4,
                   "total_sessions": 12, "total_bandwidth_gb": 3.5}
    }"#;

    fn snapshot(text: &str) -> AccountSnapshot {
        AccountSnapshot {
            facts: parse_account(text).unwrap(),
            fetched_unix: 1_700_000_000,
        }
    }

    #[test]
    fn a_full_report_becomes_online_with_its_earnings() {
        let view = remote_view(Some(&snapshot(REPORT)));
        assert_eq!(view.server, ServerView::Online);
        assert_eq!(view.updated_at_unix, Some(1_700_000_000));
        assert_eq!(
            view.earnings,
            Some(EarningsView {
                last_7_days_sol: 0.1,
                last_30_days_sol: 0.4,
                pending_sol: 0.25,
                paid_sol: 1.0,
            })
        );
    }

    #[test]
    fn nothing_fetched_yet_is_checking() {
        assert_eq!(remote_view(None), RemoteView::default());
        assert_eq!(remote_view(None).server, ServerView::Checking);
    }

    #[test]
    fn every_server_answer_has_its_own_view() {
        let cases = [
            (
                r#"{"reachable":true,"node":{"status":"online"}}"#,
                ServerView::Online,
            ),
            (
                r#"{"reachable":true,"node":{"status":" ONLINE "}}"#,
                ServerView::Online,
            ),
            (
                r#"{"reachable":true,"node":{"status":"offline"}}"#,
                ServerView::NotSeen,
            ),
            (
                r#"{"reachable":true,"node":{"status":""}}"#,
                ServerView::NotSeen,
            ),
            (r#"{"reachable":true}"#, ServerView::NotRegistered),
            (r#"{"reachable":false}"#, ServerView::Unreachable),
            (
                r#"{"reachable":false,"auth_rejected":true}"#,
                ServerView::KeyRejected,
            ),
        ];
        for (text, expected) in cases {
            assert_eq!(
                remote_view(Some(&snapshot(text))).server,
                expected,
                "{text}"
            );
        }
    }

    /// A refused key outranks everything: the other fields describe a request that never ran.
    #[test]
    fn a_refused_key_is_never_shown_as_an_outage_or_as_online() {
        let text = r#"{"reachable":true,"auth_rejected":true,"node":{"status":"online"}}"#;
        assert_eq!(
            remote_view(Some(&snapshot(text))).server,
            ServerView::KeyRejected
        );
    }

    #[test]
    fn earnings_that_could_not_be_loaded_stay_absent_not_zero() {
        let text = r#"{"reachable":true,"node":{"status":"online"}}"#;
        assert_eq!(remote_view(Some(&snapshot(text))).earnings, None);
    }

    #[test]
    fn an_impossible_amount_is_shown_as_zero() {
        let text = r#"{"reachable":true,"earnings":{"last_7_days_sol":-3.0,
            "last_30_days_sol":1e999,"pending_sol":0.5,"paid_sol":0}}"#;
        // 1e999 overflows f64 and is rejected by the parser, so build the case from values.
        assert!(parse_account(text).is_err());
        let facts = AccountFacts {
            reachable: true,
            auth_rejected: false,
            node: None,
            earnings: Some(EarningsFacts {
                last_7_days_sol: -3.0,
                last_30_days_sol: f64::INFINITY,
                pending_sol: 0.5,
                paid_sol: f64::NAN,
            }),
        };
        let e = remote_view(Some(&AccountSnapshot {
            facts,
            fetched_unix: 1,
        }))
        .earnings
        .unwrap();
        assert_eq!(
            (
                e.last_7_days_sol,
                e.last_30_days_sol,
                e.pending_sol,
                e.paid_sol
            ),
            (0.0, 0.0, 0.5, 0.0)
        );
    }

    #[test]
    fn text_before_the_json_is_tolerated_and_garbage_is_an_error() {
        let noisy = format!("2026-11-03 INFO something\n{REPORT}");
        assert!(parse_account(&noisy).unwrap().reachable);
        for bad in ["", "no json here", "{", "[1]"] {
            assert!(parse_account(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn fields_missing_from_an_older_node_degrade_to_unreachable_not_a_crash() {
        let facts = parse_account("{}").unwrap();
        assert_eq!(server_view(&facts), ServerView::Unreachable);
        assert_eq!(facts.earnings, None);
    }

    #[test]
    fn views_serialize_with_the_tags_the_window_switches_on() {
        let v = serde_json::to_value(remote_view(Some(&snapshot(REPORT)))).unwrap();
        assert_eq!(v["server"], "online");
        assert_eq!(v["earnings"]["pending_sol"], 0.25);
        assert_eq!(v["updated_at_unix"], 1_700_000_000u64);
        let v = serde_json::to_value(RemoteView::default()).unwrap();
        assert_eq!(v["server"], "checking");
        assert!(v["updated_at_unix"].is_null());
    }
}
