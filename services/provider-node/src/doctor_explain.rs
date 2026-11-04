//! `provider-node doctor --explain`: run the doctor, then ask ProxyHubb's doctor assistant to
//! explain the results and order the fix steps in plain words. Changes nothing.
//!
//! Privacy, by construction: what leaves this computer is only each check's id, outcome,
//! severity and remediation code, plus the provider's optional words. The doctor's own
//! messages (which can hold file paths), its advice text and the config path never leave. The
//! full report is still in the output for the app, so the plain findings show even when the
//! explanation cannot be fetched. The request carries this node's provider token, so the app
//! never handles a credential.

use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::time::Duration;

use crate::config::Config;
use crate::doctor::{Check, DoctorReport};
use crate::rules_draft::web_url_for;

/// The model takes 10-25 s; leave room for one retry on the server.
const EXPLAIN_TIMEOUT: Duration = Duration::from_secs(75);
pub const MAX_TEXT_CHARS: usize = 500;

/// The only fields of a check that may leave this computer. Pinned by the tests below: if the
/// doctor's `Check` grows a field, it does not travel until it is added here on purpose.
fn sanitized_check(check: &Check) -> Value {
    let mut out = json!({
        "id": check.id,
        "ok": check.ok,
        "severity": check.severity,
    });
    if let Some(code) = &check.remediation_code {
        out["code"] = Value::String(code.clone());
    }
    out
}

pub fn sanitized_checks(report: &DoctorReport) -> Value {
    Value::Array(report.checks.iter().map(sanitized_check).collect())
}

/// What the app reads: the report always, plus `ok: true` and the advice when the assistant
/// answered, or `ok: false` and why not.
pub fn outcome_json(status: u16, body: &str, report: &DoctorReport) -> Value {
    let report_json = serde_json::to_value(report).unwrap_or(Value::Null);
    let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    if (200..300).contains(&status) && parsed.get("plan").is_some() {
        return json!({
            "ok": true,
            "report": report_json,
            "advice": parsed["plan"],
            "model": parsed.get("model").cloned().unwrap_or(Value::Null),
        });
    }
    let code = parsed
        .pointer("/error/code")
        .and_then(Value::as_str)
        .unwrap_or("explain_failed");
    let message = parsed
        .pointer("/error/message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!("The doctor assistant answered HTTP {status}. The check results still stand on their own.")
        });
    json!({ "ok": false, "status": status, "code": code, "message": message, "report": report_json })
}

fn failed_outcome(report: &DoctorReport, code: &str, message: String) -> Value {
    json!({
        "ok": false,
        "status": 0,
        "code": code,
        "message": message,
        "report": serde_json::to_value(report).unwrap_or(Value::Null),
    })
}

pub async fn explain(
    config_path: &std::path::Path,
    text: Option<&str>,
    web_url: Option<&str>,
) -> Result<Value> {
    let text = text.map(str::trim).filter(|t| !t.is_empty());
    if let Some(t) = text {
        if t.chars().count() > MAX_TEXT_CHARS {
            anyhow::bail!("Keep the description under {MAX_TEXT_CHARS} characters.");
        }
    }

    let report = crate::doctor::run(config_path.to_path_buf()).await?;

    // The assistant is asked with this node's token. Without a config there is no token; the
    // report above (which already says the computer is not connected) is the whole answer.
    if !config_path.exists() {
        return Ok(failed_outcome(
            &report,
            "not_connected",
            "This computer is not connected to an account yet, so the doctor assistant cannot be asked.".into(),
        ));
    }
    let cfg =
        match Config::load(&config_path.to_string_lossy()) {
            Ok(cfg) => cfg,
            Err(_) => return Ok(failed_outcome(
                &report,
                "config_unusable",
                "The node's settings could not be read, so the doctor assistant cannot be asked."
                    .into(),
            )),
        };
    let base = match web_url_for(&cfg.control_api_url, web_url) {
        Ok(base) => base,
        Err(e) => return Ok(failed_outcome(&report, "web_url_unknown", e.to_string())),
    };
    let (_user_id, bearer) = match crate::status::resolve_control_bearer(&cfg).await {
        Ok(found) => found,
        Err(e) => {
            return Ok(failed_outcome(
                &report,
                "no_token",
                format!("This node's key could not be used to ask the doctor assistant: {e}"),
            ))
        }
    };

    let resp = reqwest::Client::builder()
        .timeout(EXPLAIN_TIMEOUT)
        .build()?
        .post(format!("{base}/api/provider-doctor/draft"))
        .header("Authorization", format!("Bearer {bearer}"))
        .json(&json!({ "request": text, "checks": sanitized_checks(&report) }))
        .send()
        .await
        .context("Could not reach the doctor assistant")?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Ok(outcome_json(status, &body, &report))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report() -> DoctorReport {
        DoctorReport {
            config_path: "C:\\Users\\you\\AppData\\Roaming\\proxyhubb\\provider.toml".into(),
            ok: false,
            checks: vec![
                Check {
                    id: "gateway".into(),
                    ok: false,
                    severity: "error".into(),
                    message: "TCP dial to proxy.proxyhubb.com failed from C:\\Users\\you".into(),
                    remediation: Some("Set api_key = \"pnode_secret\" in provider.toml".into()),
                    remediation_code: Some("gateway_tcp_unreachable".into()),
                },
                Check {
                    id: "daemon".into(),
                    ok: true,
                    severity: "info".into(),
                    message: "Provider node running".into(),
                    remediation: None,
                    remediation_code: None,
                },
            ],
        }
    }

    #[test]
    fn only_ids_outcomes_severities_and_codes_leave_this_computer() {
        let sent = sanitized_checks(&report());
        assert_eq!(
            sent,
            json!([
                { "id": "gateway", "ok": false, "severity": "error", "code": "gateway_tcp_unreachable" },
                { "id": "daemon", "ok": true, "severity": "info" },
            ])
        );
        let flat = sent.to_string();
        assert!(!flat.contains("Users"), "a path leaked: {flat}");
        assert!(!flat.contains("pnode_secret"), "a key leaked: {flat}");
        assert!(
            !flat.contains("provider.toml"),
            "a file name leaked: {flat}"
        );
    }

    #[test]
    fn an_answer_becomes_advice_next_to_the_full_report() {
        let out = outcome_json(
            200,
            r#"{"plan":{"summary":"The gateway is unreachable.","steps":[],"healthy":false,"refused":false},"model":{"id":"muse-spark-1.3","dataMode":"standard"}}"#,
            &report(),
        );
        assert_eq!(out["ok"], true);
        assert_eq!(out["advice"]["summary"], "The gateway is unreachable.");
        assert_eq!(out["model"]["id"], "muse-spark-1.3");
        // The report the app shows as findings is the doctor's full one, paths and all: it
        // stays on this computer.
        assert_eq!(out["report"]["checks"][0]["id"], "gateway");
    }

    #[test]
    fn a_failure_keeps_the_report_and_the_servers_message() {
        let out = outcome_json(
            503,
            r#"{"error":{"code":"model_unavailable","message":"The model did not answer."}}"#,
            &report(),
        );
        assert_eq!(out["ok"], false);
        assert_eq!(out["code"], "model_unavailable");
        assert_eq!(out["message"], "The model did not answer.");
        assert_eq!(out["report"]["checks"][1]["id"], "daemon");

        let out = outcome_json(502, "<html>bad gateway</html>", &report());
        assert_eq!(out["code"], "explain_failed");
        assert!(out["message"].as_str().unwrap().contains("HTTP 502"));
        // A 200 without a plan is not advice.
        assert_eq!(outcome_json(200, "{}", &report())["ok"], false);
    }
}
