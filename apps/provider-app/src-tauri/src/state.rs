//! What the UI shows. It is derived from facts each time, never stored, so it cannot drift
//! from what the node is actually doing.

use serde::Serialize;

/// Facts about the local node, gathered by the driver from `provider-node status --json`
/// and the files next to it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NodeFacts {
    /// A `provider.toml` exists (the node has been paired or set up).
    pub config_present: bool,
    pub process_running: bool,
    pub tunnel_connected: bool,
    /// The node's own last connection error, if any.
    pub last_error: Option<String>,
    /// Set when the app tried to start the node and that failed.
    pub start_failed: Option<String>,
    pub metrics: Option<Metrics>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Metrics {
    pub uptime_seconds: u64,
    pub bytes_up: u64,
    pub bytes_down: u64,
    pub active_connections: i32,
}

/// A pairing in progress, with the code the person has to approve.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PairingView {
    pub user_code: String,
    pub link: String,
    pub expires_in: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AppState {
    /// First run, or the consent wording changed since they agreed.
    NeedsConsent,
    /// Consent given, but this computer is not connected to an account yet.
    NeedsPairing,
    Pairing {
        user_code: String,
        link: String,
        expires_in: u64,
    },
    /// The node is starting or reconnecting.
    Connecting {
        detail: Option<String>,
    },
    Sharing {
        uptime_seconds: u64,
        bytes_up: u64,
        bytes_down: u64,
        active_connections: i32,
    },
    Paused,
    Problem {
        reason: String,
    },
}

/// The precedence is deliberate: consent comes before everything (nothing runs or is shown
/// as running on someone's behalf without it), then an active pairing, then setup, then
/// what the node is doing.
pub fn derive_state(
    consent_current: bool,
    sharing_wanted: bool,
    pairing: Option<&PairingView>,
    facts: &NodeFacts,
) -> AppState {
    if !consent_current {
        return AppState::NeedsConsent;
    }
    if let Some(p) = pairing {
        return AppState::Pairing {
            user_code: p.user_code.clone(),
            link: p.link.clone(),
            expires_in: p.expires_in,
        };
    }
    if !facts.config_present {
        return AppState::NeedsPairing;
    }
    if facts.process_running {
        if facts.tunnel_connected {
            let m = facts.metrics.clone().unwrap_or_default();
            return AppState::Sharing {
                uptime_seconds: m.uptime_seconds,
                bytes_up: m.bytes_up,
                bytes_down: m.bytes_down,
                active_connections: m.active_connections,
            };
        }
        return AppState::Connecting {
            detail: facts.last_error.clone(),
        };
    }
    // Not running.
    if sharing_wanted {
        return match &facts.start_failed {
            Some(reason) => AppState::Problem {
                reason: reason.clone(),
            },
            // The app is about to start it (or just did).
            None => AppState::Connecting { detail: None },
        };
    }
    AppState::Paused
}

/// The tray icon's hover text: one plain phrase for what the app is doing.
pub fn tooltip_for(state: &AppState) -> &'static str {
    match state {
        AppState::NeedsConsent | AppState::NeedsPairing | AppState::Pairing { .. } => {
            "ProxyHubb Provider: not set up yet"
        }
        AppState::Connecting { .. } => "ProxyHubb Provider: connecting",
        AppState::Sharing { .. } => "ProxyHubb Provider: sharing",
        AppState::Paused => "ProxyHubb Provider: paused",
        AppState::Problem { .. } => "ProxyHubb Provider: needs attention",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paired() -> NodeFacts {
        NodeFacts {
            config_present: true,
            ..NodeFacts::default()
        }
    }

    fn running(tunnel: bool) -> NodeFacts {
        NodeFacts {
            config_present: true,
            process_running: true,
            tunnel_connected: tunnel,
            ..NodeFacts::default()
        }
    }

    fn pairing() -> PairingView {
        PairingView {
            user_code: "BCDF-GHJK".into(),
            link: "https://proxyhubb.com/dashboard/provider/pair?code=BCDF-GHJK".into(),
            expires_in: 600,
        }
    }

    #[test]
    fn consent_comes_before_everything_even_a_running_node() {
        let p = pairing();
        for facts in [NodeFacts::default(), paired(), running(true)] {
            assert_eq!(
                derive_state(false, true, Some(&p), &facts),
                AppState::NeedsConsent,
                "{facts:?}"
            );
        }
    }

    #[test]
    fn an_active_pairing_shows_its_code() {
        let p = pairing();
        match derive_state(true, false, Some(&p), &NodeFacts::default()) {
            AppState::Pairing {
                user_code,
                expires_in,
                ..
            } => {
                assert_eq!(user_code, "BCDF-GHJK");
                assert_eq!(expires_in, 600);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn no_config_means_pairing_is_needed() {
        assert_eq!(
            derive_state(true, true, None, &NodeFacts::default()),
            AppState::NeedsPairing
        );
    }

    #[test]
    fn running_with_the_tunnel_up_is_sharing_with_its_numbers() {
        let mut facts = running(true);
        facts.metrics = Some(Metrics {
            uptime_seconds: 90,
            bytes_up: 1,
            bytes_down: 2,
            active_connections: 3,
        });
        assert_eq!(
            derive_state(true, true, None, &facts),
            AppState::Sharing {
                uptime_seconds: 90,
                bytes_up: 1,
                bytes_down: 2,
                active_connections: 3
            }
        );
    }

    #[test]
    fn sharing_without_metrics_yet_shows_zeros_not_a_problem() {
        assert_eq!(
            derive_state(true, true, None, &running(true)),
            AppState::Sharing {
                uptime_seconds: 0,
                bytes_up: 0,
                bytes_down: 0,
                active_connections: 0
            }
        );
    }

    #[test]
    fn running_without_the_tunnel_is_connecting_and_carries_the_nodes_last_error() {
        let mut facts = running(false);
        assert_eq!(
            derive_state(true, true, None, &facts),
            AppState::Connecting { detail: None }
        );
        facts.last_error = Some("gateway unreachable".into());
        assert_eq!(
            derive_state(true, true, None, &facts),
            AppState::Connecting {
                detail: Some("gateway unreachable".into())
            }
        );
    }

    #[test]
    fn not_running_and_not_wanted_is_paused() {
        assert_eq!(derive_state(true, false, None, &paired()), AppState::Paused);
    }

    #[test]
    fn wanted_but_not_running_is_connecting_until_a_start_fails() {
        assert_eq!(
            derive_state(true, true, None, &paired()),
            AppState::Connecting { detail: None }
        );
        let mut facts = paired();
        facts.start_failed = Some("could not start the node".into());
        assert_eq!(
            derive_state(true, true, None, &facts),
            AppState::Problem {
                reason: "could not start the node".into()
            }
        );
    }

    #[test]
    fn a_failed_start_does_not_matter_once_the_user_paused() {
        let mut facts = paired();
        facts.start_failed = Some("x".into());
        assert_eq!(derive_state(true, false, None, &facts), AppState::Paused);
    }

    #[test]
    fn every_state_has_a_distinct_plain_tooltip_for_its_meaning() {
        let sharing = AppState::Sharing {
            uptime_seconds: 0,
            bytes_up: 0,
            bytes_down: 0,
            active_connections: 0,
        };
        assert_eq!(tooltip_for(&sharing), "ProxyHubb Provider: sharing");
        assert_eq!(tooltip_for(&AppState::Paused), "ProxyHubb Provider: paused");
        assert_eq!(
            tooltip_for(&AppState::Connecting { detail: None }),
            "ProxyHubb Provider: connecting"
        );
        assert_eq!(
            tooltip_for(&AppState::Problem { reason: "x".into() }),
            "ProxyHubb Provider: needs attention"
        );
        // Not-set-up states share one phrase, and none of them claims the node is sharing.
        for s in [AppState::NeedsConsent, AppState::NeedsPairing] {
            assert_eq!(tooltip_for(&s), "ProxyHubb Provider: not set up yet");
        }
    }

    #[test]
    fn states_serialize_with_a_kind_tag_the_ui_can_switch_on() {
        let json = serde_json::to_value(AppState::Paused).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "paused" }));
        let json = serde_json::to_value(AppState::Problem { reason: "r".into() }).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "problem", "reason": "r" })
        );
        let json = serde_json::to_value(derive_state(
            true,
            false,
            Some(&pairing()),
            &NodeFacts::default(),
        ))
        .unwrap();
        assert_eq!(json["kind"], "pairing");
        assert_eq!(json["user_code"], "BCDF-GHJK");
    }
}
