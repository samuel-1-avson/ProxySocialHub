//! Disconnecting this computer: the parsing of `provider-node unpair --json`.
//!
//! The node stops itself and moves `provider.toml` aside (kept, not deleted). It cannot revoke
//! the key on the server, so the window tells the person to do that in the dashboard.

use serde::{Deserialize, Serialize};

use crate::account::first_json;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct UnpairReport {
    #[serde(default)]
    pub outcome: String,
    #[serde(default)]
    pub archived_config: Option<String>,
}

/// What the window learns: where the kept settings file is, if there was one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DisconnectResult {
    pub archived_config: Option<String>,
}

/// Read `unpair --json`. An outcome the app does not know is an error: it must not claim a
/// disconnect that the node did not report.
pub fn parse_unpair(text: &str) -> Result<DisconnectResult, String> {
    let report: UnpairReport = first_json(text, "unpair")?;
    match report.outcome.as_str() {
        "disconnected" | "nothing_to_disconnect" => Ok(DisconnectResult {
            archived_config: report.archived_config,
        }),
        other => Err(format!("provider-node unpair reported {other:?}")),
    }
}

/// Plain words for an `unpair` that failed. Nothing was disconnected in any of these cases.
pub fn friendly_unpair_error(printed: &str) -> String {
    if printed
        .to_ascii_lowercase()
        .contains("did not stop in time")
    {
        "The node did not stop in time, so nothing was disconnected. Please try again.".to_string()
    } else {
        "This computer could not be disconnected. Nothing was changed.".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_disconnect_reports_where_the_settings_were_kept() {
        let text = r#"{"outcome":"disconnected","stopped_node":true,
            "archived_config":"C:/p/provider.toml.disconnected-1","archived_stats":null}"#;
        assert_eq!(
            parse_unpair(text).unwrap(),
            DisconnectResult {
                archived_config: Some("C:/p/provider.toml.disconnected-1".into())
            }
        );
    }

    #[test]
    fn a_computer_that_was_already_disconnected_is_not_an_error() {
        let text = r#"{"outcome":"nothing_to_disconnect","stopped_node":false,
            "archived_config":null,"archived_stats":null}"#;
        assert_eq!(parse_unpair(text).unwrap().archived_config, None);
    }

    #[test]
    fn an_outcome_or_output_the_app_does_not_know_is_never_read_as_success() {
        for bad in [
            r#"{"outcome":"exploded"}"#,
            r#"{}"#,
            "Error: the node did not stop in time",
            "",
        ] {
            assert!(parse_unpair(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn failures_are_explained_without_leaking_internals() {
        let slow =
            friendly_unpair_error("Error: the node did not stop in time, so nothing was changed");
        assert!(slow.contains("did not stop in time") && slow.contains("nothing was disconnected"));
        let other = friendly_unpair_error(
            "Error: could not move C:\\Users\\x\\provider.toml aside: denied",
        );
        assert!(other.contains("Nothing was changed"));
        assert!(!other.contains("C:\\") && !other.contains("provider.toml"));
    }
}
