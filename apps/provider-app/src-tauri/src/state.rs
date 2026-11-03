//! What the UI shows. It is derived from facts each time, never stored, so it cannot drift
//! from what the node is actually doing.

use serde::Serialize;

/// Where a reconnecting node stands in its gateway rotation, so the UI can say
/// "retrying" with the gateway and the error age instead of a bare failure.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct RetryFacts {
    pub active_gateway: String,
    pub gateway_index: u32,
    pub gateway_total: u32,
    /// `runtime.json` write time; the UI turns it into an age ("12s ago").
    pub updated_at_unix: u64,
}

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
    /// PID from `status --json`, when the node reports one.
    pub node_pid: Option<u32>,
    /// The running node was started outside the app (the CLI, a service). Set by the
    /// engine, which knows what it started itself; never parsed from status output.
    pub externally_started: bool,
    /// Present while the node runs without a tunnel and reports retry context.
    pub retry: Option<RetryFacts>,
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
        retry: Option<RetryFacts>,
        /// The node was started outside the app. Stopping it asks first.
        managed_externally: bool,
    },
    Sharing {
        uptime_seconds: u64,
        bytes_up: u64,
        bytes_down: u64,
        active_connections: i32,
        /// The node was started outside the app. Pause does not stop it; stopping it asks first.
        managed_externally: bool,
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
                managed_externally: facts.externally_started,
            };
        }
        return AppState::Connecting {
            detail: facts.last_error.clone(),
            retry: facts.retry.clone(),
            managed_externally: facts.externally_started,
        };
    }
    // Not running.
    if sharing_wanted {
        return match &facts.start_failed {
            Some(reason) => AppState::Problem {
                reason: reason.clone(),
            },
            // The app is about to start it (or just did).
            None => AppState::Connecting {
                detail: None,
                retry: None,
                managed_externally: false,
            },
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

/// What the tray menu shows for a state: one status line, and which actions can be taken right
/// now. Pure, so the rules are tested without a tray.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayView {
    pub status: String,
    pub pause_enabled: bool,
    pub resume_enabled: bool,
    pub quit_label: &'static str,
}

pub fn tray_view_for(state: &AppState) -> TrayView {
    // (status line, Pause enabled, Resume enabled, a node the app did not start is running)
    let (status, pause_enabled, resume_enabled, outside) = match state {
        AppState::NeedsConsent | AppState::NeedsPairing | AppState::Pairing { .. } => {
            ("Not set up yet".to_string(), false, false, false)
        }
        AppState::Connecting {
            managed_externally: true,
            ..
        } => (
            "Connecting (started outside this app)".to_string(),
            false,
            false,
            true,
        ),
        AppState::Connecting { .. } => ("Connecting…".to_string(), true, false, false),
        AppState::Sharing {
            managed_externally: true,
            ..
        } => (
            "Sharing (started outside this app)".to_string(),
            false,
            false,
            true,
        ),
        AppState::Sharing {
            active_connections, ..
        } => (
            format!("Sharing · {}", connections_text(*active_connections)),
            true,
            false,
            false,
        ),
        AppState::Paused => ("Paused".to_string(), false, true, false),
        // Resume doubles as "Try again" here.
        AppState::Problem { .. } => ("Needs attention".to_string(), false, true, false),
    };
    TrayView {
        status,
        pause_enabled,
        resume_enabled,
        quit_label: if outside {
            "Quit (the node keeps running)"
        } else {
            "Quit (stops sharing)"
        },
    }
}

fn connections_text(n: i32) -> String {
    match n.max(0) {
        1 => "1 connection".to_string(),
        n => format!("{n} connections"),
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
                active_connections: 3,
                managed_externally: false,
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
                active_connections: 0,
                managed_externally: false,
            }
        );
    }

    #[test]
    fn running_without_the_tunnel_is_connecting_and_carries_the_nodes_last_error() {
        let mut facts = running(false);
        assert_eq!(
            derive_state(true, true, None, &facts),
            AppState::Connecting {
                detail: None,
                retry: None,
                managed_externally: false,
            }
        );
        facts.last_error = Some("gateway unreachable".into());
        assert_eq!(
            derive_state(true, true, None, &facts),
            AppState::Connecting {
                detail: Some("gateway unreachable".into()),
                retry: None,
                managed_externally: false,
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
            AppState::Connecting {
                detail: None,
                retry: None,
                managed_externally: false,
            }
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
            managed_externally: false,
        };
        assert_eq!(tooltip_for(&sharing), "ProxyHubb Provider: sharing");
        assert_eq!(tooltip_for(&AppState::Paused), "ProxyHubb Provider: paused");
        assert_eq!(
            tooltip_for(&AppState::Connecting {
                detail: None,
                retry: None,
                managed_externally: false,
            }),
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
    fn retry_context_is_carried_into_connecting_for_the_ui() {
        let mut facts = running(false);
        facts.retry = Some(RetryFacts {
            active_gateway: "gw:3128".into(),
            gateway_index: 0,
            gateway_total: 2,
            updated_at_unix: 1700000000,
        });
        match derive_state(true, true, None, &facts) {
            AppState::Connecting { retry, .. } => {
                let r = retry.expect("retry context present");
                assert_eq!(r.active_gateway, "gw:3128");
                assert_eq!((r.gateway_index, r.gateway_total), (0, 2));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn an_externally_started_node_is_flagged_on_sharing() {
        let mut facts = running(true);
        facts.externally_started = true;
        match derive_state(true, true, None, &facts) {
            AppState::Sharing {
                managed_externally, ..
            } => assert!(managed_externally),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn an_externally_started_node_is_flagged_while_it_connects_too() {
        let mut facts = running(false);
        facts.externally_started = true;
        match derive_state(true, true, None, &facts) {
            AppState::Connecting {
                managed_externally, ..
            } => assert!(managed_externally),
            other => panic!("{other:?}"),
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
        let json = serde_json::to_value(AppState::Connecting {
            detail: None,
            retry: None,
            managed_externally: true,
        })
        .unwrap();
        assert_eq!(json["managed_externally"], true);
    }

    #[test]
    fn the_tray_offers_only_the_actions_that_can_run_now() {
        let sharing = |n: i32, outside: bool| AppState::Sharing {
            uptime_seconds: 0,
            bytes_up: 0,
            bytes_down: 0,
            active_connections: n,
            managed_externally: outside,
        };

        let mine = tray_view_for(&sharing(3, false));
        assert_eq!(mine.status, "Sharing · 3 connections");
        assert!(mine.pause_enabled && !mine.resume_enabled);
        assert_eq!(mine.quit_label, "Quit (stops sharing)");
        assert_eq!(
            tray_view_for(&sharing(1, false)).status,
            "Sharing · 1 connection"
        );

        // Pause never stops a node the app did not start, so the menu does not offer it.
        let theirs = tray_view_for(&sharing(0, true));
        assert_eq!(theirs.status, "Sharing (started outside this app)");
        assert!(!theirs.pause_enabled);
        assert_eq!(theirs.quit_label, "Quit (the node keeps running)");

        let paused = tray_view_for(&AppState::Paused);
        assert!(!paused.pause_enabled && paused.resume_enabled);

        // Resume doubles as "Try again" after a problem.
        let problem = tray_view_for(&AppState::Problem { reason: "x".into() });
        assert!(problem.resume_enabled);

        let connecting = tray_view_for(&AppState::Connecting {
            detail: None,
            retry: None,
            managed_externally: false,
        });
        assert!(connecting.pause_enabled);

        for s in [AppState::NeedsConsent, AppState::NeedsPairing] {
            let v = tray_view_for(&s);
            assert_eq!(
                (v.status.as_str(), v.pause_enabled, v.resume_enabled),
                ("Not set up yet", false, false)
            );
        }
    }
}
