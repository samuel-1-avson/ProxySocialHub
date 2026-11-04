//! The sites this computer refuses to connect to: a change drafted from the provider's own words
//! (`provider-node rules draft --json`) and an approved list saved to the node
//! (`provider-node config set-blocked-sites --json`).
//!
//! The node enforces the list on this computer before it connects anywhere. The app never sees a
//! credential: the node sends the draft request with its own token.

use serde::{Deserialize, Serialize};

use crate::account::first_json;

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct RuleChange {
    pub host: String,
    /// `named` or `category:<id>`.
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct RulesNote {
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct RulesCategory {
    pub id: String,
    pub label: String,
    pub sites: u32,
    pub action: String,
}

/// The checked plan from the rules assistant (apps/web/src/lib/provider-rules.ts).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RulesPlan {
    #[serde(default)]
    pub blocked: Vec<String>,
    #[serde(default)]
    pub added: Vec<RuleChange>,
    #[serde(default)]
    pub removed: Vec<RuleChange>,
    #[serde(default)]
    pub categories: Vec<RulesCategory>,
    #[serde(default)]
    pub rejected: Vec<String>,
    #[serde(default)]
    pub notes: Vec<RulesNote>,
    #[serde(default)]
    pub assumptions: Vec<String>,
    #[serde(default)]
    pub cannot_do: Vec<String>,
    #[serde(default)]
    pub unchanged: bool,
    #[serde(default)]
    pub refused: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RulesDraft {
    pub plan: RulesPlan,
    pub model: String,
    /// `standard` (not used for training) or `contributor`.
    pub data_mode: String,
}

/// What `config set-blocked-sites --json` reports.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct BlockedSitesReport {
    #[serde(default)]
    pub blocked_hosts: Vec<String>,
    #[serde(default)]
    pub rejected: Vec<String>,
    #[serde(default)]
    pub truncated: bool,
    #[serde(default)]
    pub changed: bool,
}

/// The saved list, and whether the node was restarted to apply it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedSitesSaved {
    pub blocked_hosts: Vec<String>,
    pub rejected: Vec<String>,
    pub changed: bool,
    /// The node was running under this app and was restarted, so the list is in force now.
    pub restarted: bool,
    /// The node is running but was started elsewhere: the list applies after it is restarted.
    pub needs_restart: bool,
}

#[derive(Deserialize)]
struct Outcome {
    #[serde(default)]
    ok: Option<bool>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    plan: Option<RulesPlan>,
    #[serde(default)]
    model: Option<ModelInfo>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelInfo {
    #[serde(default)]
    id: String,
    #[serde(default)]
    data_mode: String,
}

pub fn parse_draft(text: &str) -> Result<RulesDraft, String> {
    let out: Outcome = first_json(text, "rules draft")?;
    match (out.ok, out.plan) {
        (Some(true), Some(plan)) => {
            let model = out.model.unwrap_or(ModelInfo { id: String::new(), data_mode: String::new() });
            Ok(RulesDraft { plan, model: model.id, data_mode: model.data_mode })
        }
        _ => Err(out
            .message
            .unwrap_or_else(|| "The rules assistant gave no usable answer. Edit the list yourself.".to_string())),
    }
}

pub fn parse_set(text: &str) -> Result<BlockedSitesReport, String> {
    #[derive(Deserialize)]
    struct Failure {
        ok: Option<bool>,
        message: Option<String>,
    }
    if let Ok(f) = first_json::<Failure>(text, "config set-blocked-sites") {
        if f.ok == Some(false) {
            return Err(f.message.unwrap_or_else(|| "The list could not be saved.".to_string()));
        }
    }
    first_json(text, "config set-blocked-sites")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_draft_is_read_from_the_nodes_json() {
        let text = r#"{
          "ok": true,
          "plan": {"blocked":["old.example","bet365.com"],"added":[{"host":"bet365.com","source":"category:gambling"}],
                   "removed":[],"categories":[{"id":"gambling","label":"Gambling and betting","sites":30,"action":"block"}],
                   "rejected":[],"notes":[{"level":"info","message":"Categories cover a short list."}],
                   "assumptions":["Gambling includes betting sites."],"cannotDo":["Evenings only is not possible."],
                   "unchanged":false,"refused":false},
          "draft": {"block_categories":["gambling"]},
          "model": {"id":"muse-spark-1.3","dataMode":"standard"}
        }"#;
        let d = parse_draft(text).unwrap();
        assert_eq!(d.plan.blocked, vec!["old.example", "bet365.com"]);
        assert_eq!(d.plan.cannot_do, vec!["Evenings only is not possible."]);
        assert_eq!(d.model, "muse-spark-1.3");
        assert_eq!(d.data_mode, "standard");
        // The window reads camelCase.
        let json = serde_json::to_value(&d).unwrap();
        assert_eq!(json["plan"]["cannotDo"][0], "Evenings only is not possible.");
        assert_eq!(json["dataMode"], "standard");
    }

    #[test]
    fn a_failed_draft_gives_the_nodes_message() {
        let text = r#"{"ok":false,"status":503,"code":"model_unavailable","message":"The model did not answer. Edit the list yourself."}"#;
        assert_eq!(parse_draft(text).unwrap_err(), "The model did not answer. Edit the list yourself.");
        assert!(parse_draft("no json at all").unwrap_err().contains("printed no JSON"));
    }

    #[test]
    fn a_saved_list_or_its_failure_is_read() {
        let ok = parse_set(r#"{"config_path":"C:/p/provider.toml","blocked_hosts":["bet365.com"],"rejected":["10.0.0.1"],"truncated":false,"changed":true}"#).unwrap();
        assert_eq!(ok.blocked_hosts, vec!["bet365.com"]);
        assert_eq!(ok.rejected, vec!["10.0.0.1"]);
        assert!(ok.changed);
        let err = parse_set(r#"{"ok":false,"message":"This computer is not connected to an account yet."}"#).unwrap_err();
        assert!(err.contains("not connected"));
    }
}
