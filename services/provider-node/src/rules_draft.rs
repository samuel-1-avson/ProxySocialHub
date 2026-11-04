//! `provider-node rules draft`: ask ProxyHubb's rules assistant to turn the provider's own words
//! into a change to this computer's blocked sites. Changes nothing; the provider app shows the
//! plan and, once the provider approves it, saves it with `config set-blocked-sites`.
//!
//! The request carries this node's provider token, so the app never handles a credential, and
//! the node's current list, so "also" and "stop blocking" can be understood.

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::time::Duration;

use crate::config::Config;

/// The model takes 10-25 s; leave room for one retry on the server.
const DRAFT_TIMEOUT: Duration = Duration::from_secs(75);
pub const MAX_TEXT_CHARS: usize = 500;

/// The website that serves `/api/provider-rules/draft`: the explicit one, else the control API's
/// host without its `api.` label (`https://api.proxyhubb.com` -> `https://proxyhubb.com`).
pub fn web_url_for(control_api_url: &str, explicit: Option<&str>) -> Result<String> {
    if let Some(url) = explicit.map(str::trim).filter(|u| !u.is_empty()) {
        return Ok(url.trim_end_matches('/').to_string());
    }
    let url = reqwest::Url::parse(control_api_url.trim()).context("control_api_url is not a URL")?;
    let host = url.host_str().unwrap_or_default();
    match host.strip_prefix("api.") {
        Some(site) if site.contains('.') => Ok(format!("{}://{site}", url.scheme())),
        _ => bail!("Cannot tell the website address from {control_api_url}; pass --web-url (or set PROXYHUB_WEB_URL)."),
    }
}

/// What the app reads: the server's answer with `ok: true`, or `ok: false` and why.
pub fn outcome_json(status: u16, body: &str) -> Value {
    let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    if (200..300).contains(&status) && parsed.get("plan").is_some() {
        let mut out = parsed;
        out["ok"] = Value::Bool(true);
        return out;
    }
    let code = parsed
        .pointer("/error/code")
        .and_then(Value::as_str)
        .unwrap_or("draft_failed");
    let message = parsed
        .pointer("/error/message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("The rules assistant answered HTTP {status}. Edit the list yourself."));
    json!({ "ok": false, "status": status, "code": code, "message": message })
}

pub async fn draft(config_path: &std::path::Path, text: &str, web_url: Option<&str>) -> Result<Value> {
    let text = text.trim();
    if text.is_empty() {
        bail!("Describe the sites you want to block or allow.");
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        bail!("Keep the description under {MAX_TEXT_CHARS} characters.");
    }
    if !config_path.exists() {
        bail!("This computer is not connected to an account yet.");
    }
    let cfg = Config::load(&config_path.to_string_lossy())?;
    let base = web_url_for(&cfg.control_api_url, web_url)?;
    let (_user_id, bearer) = crate::status::resolve_control_bearer(&cfg).await?;

    let resp = reqwest::Client::builder()
        .timeout(DRAFT_TIMEOUT)
        .build()?
        .post(format!("{base}/api/provider-rules/draft"))
        .header("Authorization", format!("Bearer {bearer}"))
        .json(&json!({ "request": text, "current": cfg.blocked_hosts }))
        .send()
        .await
        .context("Could not reach the rules assistant")?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Ok(outcome_json(status, &body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_website_is_the_control_api_host_without_api() {
        assert_eq!(web_url_for("https://api.proxyhubb.com", None).unwrap(), "https://proxyhubb.com");
        assert_eq!(web_url_for("https://api.proxyhubb.com/", None).unwrap(), "https://proxyhubb.com");
        assert_eq!(web_url_for("http://localhost:18080", Some("http://localhost:4011/")).unwrap(), "http://localhost:4011");
        assert!(web_url_for("http://localhost:18080", None).is_err());
        assert!(web_url_for("https://api.com", None).is_err());
    }

    #[test]
    fn a_plan_is_passed_through_with_ok_true() {
        let out = outcome_json(200, r#"{"plan":{"blocked":["bet365.com"]},"model":{"id":"m"}}"#);
        assert_eq!(out["ok"], true);
        assert_eq!(out["plan"]["blocked"][0], "bet365.com");
    }

    #[test]
    fn errors_keep_the_servers_message_or_explain_the_status() {
        let out = outcome_json(401, r#"{"error":{"code":"unauthorized","message":"Sign in."}}"#);
        assert_eq!(out, json!({ "ok": false, "status": 401, "code": "unauthorized", "message": "Sign in." }));
        let out = outcome_json(502, "<html>bad gateway</html>");
        assert_eq!(out["ok"], false);
        assert_eq!(out["code"], "draft_failed");
        assert!(out["message"].as_str().unwrap().contains("HTTP 502"));
        // A 200 without a plan is not a plan.
        assert_eq!(outcome_json(200, "{}")["ok"], false);
    }
}
