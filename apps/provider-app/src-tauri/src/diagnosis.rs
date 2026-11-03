//! "Check my connection": the node's `doctor --json` report, said in plain words.
//!
//! The doctor's own messages and advice are written for a terminal (they name `provider.toml`,
//! `api_key` and shell commands, and some carry file paths), so none of that text reaches the
//! window. The app has its own wording per `remediation_code`; a check it has no wording for
//! becomes a generic line that points at the support file, where the full report is.
//!
//! `provider-node`'s `doctor::tests` pin the fields read here and the codes below.

use serde::{Deserialize, Serialize};

use crate::account::first_json;

/// How many findings the window lists. The rest are in the support file.
const MAX_FINDINGS: usize = 4;

#[derive(Debug, Deserialize)]
struct DoctorJson {
    #[serde(default)]
    checks: Vec<CheckJson>,
}

#[derive(Debug, Deserialize)]
struct CheckJson {
    #[serde(default)]
    id: String,
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    severity: String,
    #[serde(default)]
    remediation_code: Option<String>,
    /// Read only to tell apart causes that share a code; never shown (it can hold paths).
    #[serde(default)]
    message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    /// Something that stops sharing from working.
    Problem,
    /// Worth knowing; sharing can still work.
    Note,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Finding {
    pub level: Level,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Diagnosis {
    /// Empty when every check passed.
    pub findings: Vec<Finding>,
}

/// The doctor files "the key did not work" and "the servers could not be reached" under the same
/// code. Only the first means the person has to reconnect, so the server's own words decide.
///
/// The phrases are specific to a refusal on purpose. Do not add the bare word "token": the node's
/// message ends with advice that always says it ("Create a fresh token in Dashboard..."), so a 502
/// during a deploy would read as a revoked key. The tests with the real message shape pin this.
fn key_was_refused(message: &str) -> bool {
    let said = message.to_ascii_lowercase();
    said.contains("invalid or inactive provider token")
        || said.contains("provider token expired")
        || said.contains("unauthorized")
        || said.contains("http 401")
        || said.contains("http 403")
}

const KEY_NOT_CONFIRMED: &str =
    "ProxyHubb's servers could not confirm this computer's key right now. This is usually temporary, so try again in a few minutes.";

const SETTINGS_PROBLEM: &str =
    "The node's settings have a problem. Save the support details and send them to ProxyHubb support.";

/// The window's wording for a doctor `remediation_code`, or `None` for a code it does not know.
fn wording(code: &str) -> Option<&'static str> {
    Some(match code {
        "config_missing" => "This computer is not connected to an account yet.",
        "control_api_unreachable" => {
            "This computer cannot reach ProxyHubb's servers. Check your internet connection."
        }
        "control_api_unhealthy" => {
            "ProxyHubb's servers answered with an error. This is usually temporary, so try again in a few minutes."
        }
        "provider_auth_failed" => {
            "ProxyHubb did not accept this computer's key. It may have been revoked in your dashboard, in which case this computer has to be connected again."
        }
        "gateway_dns_failed" => {
            "This computer could not look up ProxyHubb's gateway address. Check your internet connection or your DNS settings."
        }
        "gateway_tcp_unreachable"
        | "gateway_tls_failed"
        | "gateway_udp_unreachable"
        | "gateway_udp_socket_failed" => {
            "This computer could not open a connection to ProxyHubb's gateway. A firewall, VPN or network filter may be blocking it."
        }
        "daemon_not_running" => "The node is not running on this computer.",
        "daemon_stale_pid" => {
            "A previous run left a stale marker behind. Pausing and then resuming sharing clears it."
        }
        "metrics_unreachable" | "metrics_unhealthy" => {
            "The node is not answering on this computer. Pausing and then resuming sharing usually fixes it."
        }
        "config_parse_failed"
        | "gateway_invalid"
        | "gateway_missing"
        | "control_api_url_missing"
        | "credentials_missing"
        | "signing_key_invalid"
        | "signing_key_missing"
        | "jwt_token_only"
        | "quic_feature_missing"
        | "quic_tls_config"
        | "tls_required_public_gateway" => SETTINGS_PROBLEM,
        _ => return None,
    })
}

/// Turn the doctor's report into the findings to show: failed checks only, problems before
/// notes, the same sentence never twice, at most `MAX_FINDINGS`.
pub fn findings_from(text: &str) -> Result<Diagnosis, String> {
    let report: DoctorJson = first_json(text, "doctor")?;
    let mut problems = Vec::new();
    let mut notes = Vec::new();
    let servers_unreachable = report
        .checks
        .iter()
        .any(|c| !c.ok && c.remediation_code.as_deref() == Some("control_api_unreachable"));
    for check in report.checks.iter().filter(|c| !c.ok) {
        let (level, bucket) = match check.severity.as_str() {
            "error" => (Level::Problem, &mut problems),
            "warn" => (Level::Note, &mut notes),
            _ => continue,
        };
        let code = check.remediation_code.as_deref();
        if code == Some("provider_auth_failed") && !key_was_refused(&check.message) {
            // Not a refusal. If the servers cannot be reached at all, that is already said.
            if servers_unreachable {
                continue;
            }
            let text = KEY_NOT_CONFIRMED.to_string();
            if !bucket.iter().any(|f: &Finding| f.text == text) {
                bucket.push(Finding { level, text });
            }
            continue;
        }
        let text = code
            .and_then(wording)
            .map(str::to_string)
            .unwrap_or_else(|| {
                format!(
                    "A check did not pass ({}). Save the support details and send them to ProxyHubb support.",
                    check.id
                )
            });
        if !bucket.iter().any(|f: &Finding| f.text == text) {
            bucket.push(Finding { level, text });
        }
    }
    problems.append(&mut notes);
    problems.truncate(MAX_FINDINGS);
    Ok(Diagnosis { findings: problems })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(checks: &[(&str, bool, &str, Option<&str>)]) -> String {
        let items: Vec<String> = checks
            .iter()
            .map(|(id, ok, severity, code)| {
                let code = code
                    .map(|c| format!(r#","remediation_code":"{c}""#))
                    .unwrap_or_default();
                format!(
                    r#"{{"id":"{id}","ok":{ok},"severity":"{severity}","message":"C:\\Users\\someone\\provider.toml api_key=abc"{code}}}"#
                )
            })
            .collect();
        format!(
            r#"{{"config_path":"x","ok":false,"checks":[{}]}}"#,
            items.join(",")
        )
    }

    /// A report with the doctor's real messages for the checks named, as seen against a server
    /// that could not be reached (message texts from a real run, paths removed).
    fn report_with_messages(checks: &[(&str, &str, &str, &str)]) -> String {
        let items: Vec<String> = checks
            .iter()
            .map(|(id, severity, code, message)| {
                format!(
                    r#"{{"id":"{id}","ok":false,"severity":"{severity}","message":"{message}","remediation_code":"{code}"}}"#
                )
            })
            .collect();
        format!(r#"{{"ok":false,"checks":[{}]}}"#, items.join(","))
    }

    const REFUSED: &str = "Provider auth failed: Authentication failed: invalid or inactive provider token. Create a fresh token in Dashboard";

    /// What a real run said with the internet down: the key check fails only because the servers
    /// cannot be reached. Telling that person their key was refused would send them off to
    /// reconnect for nothing.
    #[test]
    fn with_no_connection_the_key_is_not_blamed() {
        let text = report_with_messages(&[
            (
                "control_api_health",
                "error",
                "control_api_unreachable",
                "Cannot reach Control API: error sending request",
            ),
            (
                "provider_auth",
                "error",
                "provider_auth_failed",
                "Provider auth failed: Failed to connect to Control API",
            ),
        ]);
        let d = findings_from(&text).unwrap();
        assert_eq!(d.findings.len(), 1, "{d:?}");
        assert!(d.findings[0]
            .text
            .contains("cannot reach ProxyHubb's servers"));
    }

    #[test]
    fn a_refused_key_is_reported_as_one_and_a_server_error_is_not() {
        let refused =
            report_with_messages(&[("provider_auth", "error", "provider_auth_failed", REFUSED)]);
        assert!(findings_from(&refused).unwrap().findings[0]
            .text
            .contains("did not accept"));

        for said in [
            "HTTP 502 Bad Gateway",
            "HTTP 500 Internal Server Error",
            "HTTP 429 Too Many Requests",
        ] {
            let message = format!(
                "Provider auth failed: Authentication failed: {said}. Create a fresh token in Dashboard"
            );
            let text = report_with_messages(&[(
                "provider_auth",
                "error",
                "provider_auth_failed",
                &message,
            )]);
            let d = findings_from(&text).unwrap();
            assert_eq!(d.findings.len(), 1, "{said}");
            assert!(
                d.findings[0].text.contains("could not confirm"),
                "{said}: {d:?}"
            );
            assert!(!d.findings[0].text.contains("did not accept"), "{said}");
        }
    }

    #[test]
    fn a_refused_key_is_still_reported_when_the_servers_are_also_unreachable() {
        // Two different problems; the refusal is not hidden by the outage.
        let text = report_with_messages(&[
            (
                "control_api_health",
                "error",
                "control_api_unreachable",
                "Cannot reach Control API",
            ),
            ("provider_auth", "error", "provider_auth_failed", REFUSED),
        ]);
        assert_eq!(findings_from(&text).unwrap().findings.len(), 2);
    }

    #[test]
    fn a_report_where_everything_passed_has_no_findings() {
        let text = report(&[
            ("daemon", true, "info", None),
            ("gateway", true, "error", None),
        ]);
        assert!(findings_from(&text).unwrap().findings.is_empty());
    }

    #[test]
    fn failed_checks_become_the_apps_own_words_never_the_doctors() {
        let text = report(&[
            (
                "control_api_health",
                false,
                "error",
                Some("control_api_unreachable"),
            ),
            ("gateway_dns", false, "error", Some("gateway_dns_failed")),
        ]);
        let d = findings_from(&text).unwrap();
        assert_eq!(d.findings.len(), 2);
        assert!(d.findings[0]
            .text
            .contains("cannot reach ProxyHubb's servers"));
        assert!(d.findings[1]
            .text
            .contains("could not look up ProxyHubb's gateway"));
        // Nothing of the doctor's own text (paths, key names) is shown.
        for f in &d.findings {
            for leak in ["C:\\", "provider.toml", "api_key", "provider-node "] {
                assert!(!f.text.contains(leak), "{leak} in {}", f.text);
            }
        }
    }

    #[test]
    fn problems_come_before_notes_and_notes_are_marked() {
        let text = report(&[
            ("metrics", false, "warn", Some("metrics_unreachable")),
            ("gateway_dns", false, "error", Some("gateway_dns_failed")),
        ]);
        let d = findings_from(&text).unwrap();
        assert_eq!(d.findings[0].level, Level::Problem);
        assert_eq!(d.findings[1].level, Level::Note);
    }

    #[test]
    fn passing_and_informational_checks_are_never_listed() {
        let text = report(&[
            ("daemon", true, "error", Some("daemon_not_running")),
            ("auth_model", false, "info", Some("jwt_token_only")),
        ]);
        assert!(findings_from(&text).unwrap().findings.is_empty());
    }

    #[test]
    fn several_checks_with_the_same_cause_say_it_once() {
        let text = report(&[
            (
                "gateway_reachability",
                false,
                "error",
                Some("gateway_tcp_unreachable"),
            ),
            (
                "gateway_transport",
                false,
                "error",
                Some("gateway_tls_failed"),
            ),
            ("gateway", false, "error", Some("gateway_udp_unreachable")),
        ]);
        assert_eq!(findings_from(&text).unwrap().findings.len(), 1);
    }

    #[test]
    fn a_code_the_app_has_no_words_for_points_at_the_support_file() {
        let text = report(&[
            ("brand_new_check", false, "error", Some("something_new")),
            ("another_check", false, "error", None),
        ]);
        let d = findings_from(&text).unwrap();
        assert_eq!(d.findings.len(), 2);
        assert!(d.findings[0].text.contains("(brand_new_check)"));
        assert!(d.findings[0].text.contains("support details"));
        assert!(d.findings[1].text.contains("(another_check)"));
    }

    #[test]
    fn no_more_than_the_limit_are_listed() {
        let text = report(&[
            ("a", false, "error", Some("config_missing")),
            ("b", false, "error", Some("control_api_unreachable")),
            ("c", false, "error", Some("provider_auth_failed")),
            ("d", false, "error", Some("gateway_dns_failed")),
            ("e", false, "error", Some("daemon_not_running")),
            ("f", false, "error", Some("daemon_stale_pid")),
        ]);
        assert_eq!(findings_from(&text).unwrap().findings.len(), MAX_FINDINGS);
    }

    #[test]
    fn output_around_the_json_is_tolerated_and_garbage_is_an_error() {
        let text = format!(
            "starting\n{}\ndone",
            report(&[("a", false, "error", Some("config_missing"))])
        );
        assert_eq!(findings_from(&text).unwrap().findings.len(), 1);
        for bad in ["", "nothing here", "{", r#"{"checks": 5}"#] {
            assert!(findings_from(bad).is_err(), "{bad:?}");
        }
    }

    /// Every code the app words is one the node emits, so a rename there cannot silently turn a
    /// specific finding into the generic one (the node pins the same list from its side).
    #[test]
    fn the_codes_with_wording_are_the_ones_the_node_test_pins() {
        for code in [
            "config_missing",
            "control_api_unreachable",
            "control_api_unhealthy",
            "provider_auth_failed",
            "gateway_dns_failed",
            "gateway_tcp_unreachable",
            "gateway_tls_failed",
            "daemon_not_running",
            "daemon_stale_pid",
            "metrics_unreachable",
        ] {
            assert!(wording(code).is_some(), "{code}");
        }
        assert!(wording("nonsense").is_none());
    }
}
