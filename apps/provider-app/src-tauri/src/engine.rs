//! The app's brain: consent, the sharing intent, pairing, and keeping the node running.
//!
//! It reaches the node only through `NodeControl`, so every behaviour here is tested with a
//! fake; the real `provider-node` is exercised by the end-to-end run.

use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::node::{PairEvent, PairingProcess, Sidecar};
use crate::settings::{self, Settings};
use crate::state::{derive_state, AppState, NodeFacts, PairingView};

/// After a failed start, wait this long before trying again.
const START_RETRY_COOLDOWN: Duration = Duration::from_secs(30);

pub trait NodeControl: Send + Sync + 'static {
    fn status(&self) -> Result<NodeFacts, String>;
    fn start(&self) -> Result<(), String>;
    fn stop(&self) -> Result<(), String>;
    fn pair(&self) -> Result<(PairingProcess, Receiver<PairEvent>), String>;
}

impl NodeControl for Sidecar {
    fn status(&self) -> Result<NodeFacts, String> {
        Sidecar::status(self)
    }
    fn start(&self) -> Result<(), String> {
        Sidecar::start(self)
    }
    fn stop(&self) -> Result<(), String> {
        Sidecar::stop(self)
    }
    fn pair(&self) -> Result<(PairingProcess, Receiver<PairEvent>), String> {
        Sidecar::pair(self)
    }
}

/// How a pairing ended, for the UI. `Approved` means the credentials are saved and starting the
/// node has been attempted; whether it came up shows in the state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum PairingEnded {
    Approved,
    Denied,
    Expired,
    Failed { message: String },
}

struct PairingSlot {
    /// Which pairing this is, so a late event from a cancelled one cannot touch a newer one.
    id: u64,
    view: Option<PairingView>,
    /// Held so dropping the slot cancels the process.
    _process: PairingProcess,
}

#[derive(Default)]
struct Inner {
    settings: Settings,
    pairing: Option<PairingSlot>,
    next_pairing_id: u64,
    start_failed: Option<String>,
    last_start_attempt: Option<Instant>,
}

pub struct AppCore<N: NodeControl> {
    node: N,
    settings_dir: PathBuf,
    inner: Mutex<Inner>,
}

impl<N: NodeControl> AppCore<N> {
    pub fn new(node: N, settings_dir: PathBuf) -> Self {
        let settings = settings::load(&settings_dir);
        AppCore {
            node,
            settings_dir,
            inner: Mutex::new(Inner {
                settings,
                ..Inner::default()
            }),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        // A panic elsewhere must not wedge the app; the data is still consistent enough.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn save(&self, settings: &Settings) -> Result<(), String> {
        settings::save(&self.settings_dir, settings)
            .map_err(|e| format!("could not save settings: {e}"))
    }

    /// What to show right now. Reads the node, never changes it.
    pub fn state(&self) -> AppState {
        let (consent, wanted, view, start_failed) = {
            let inner = self.lock();
            (
                inner.settings.consent_is_current(),
                inner.settings.sharing_wanted,
                inner.pairing.as_ref().and_then(|p| p.view.clone()),
                inner.start_failed.clone(),
            )
        };
        // No node call needed for these two, and the first is the privacy-sensitive gate.
        if !consent || view.is_some() {
            return derive_state(consent, wanted, view.as_ref(), &NodeFacts::default());
        }
        match self.node.status() {
            Ok(mut facts) => {
                facts.start_failed = start_failed;
                derive_state(true, wanted, None, &facts)
            }
            Err(reason) => AppState::Problem { reason },
        }
    }

    pub fn accept_consent(&self, now_unix: u64) -> Result<(), String> {
        let mut inner = self.lock();
        inner.settings.accept_consent(now_unix);
        self.save(&inner.settings)
    }

    /// Start a pairing. Returns its id and event stream, or `None` if one is already running.
    pub fn begin_pairing(&self) -> Result<Option<(u64, Receiver<PairEvent>)>, String> {
        let mut inner = self.lock();
        if !inner.settings.consent_is_current() {
            return Err("Please read and accept the consent first.".to_string());
        }
        if inner.pairing.is_some() {
            return Ok(None);
        }
        let (process, events) = self.node.pair()?;
        inner.next_pairing_id += 1;
        let id = inner.next_pairing_id;
        inner.pairing = Some(PairingSlot {
            id,
            view: None,
            _process: process,
        });
        Ok(Some((id, events)))
    }

    /// The link of the pairing in progress, once its code has arrived. The app opens this
    /// itself, so the webview never has to hand it a URL.
    pub fn pairing_link(&self) -> Option<String> {
        self.lock()
            .pairing
            .as_ref()
            .and_then(|p| p.view.as_ref())
            .map(|v| v.link.clone())
    }

    /// Give up on the current pairing, if any. Dropping the slot kills `pair --json`.
    pub fn cancel_pairing(&self) {
        self.lock().pairing = None;
    }

    /// Apply one event from pairing `id`. Returns how it ended, once it has. Events from a
    /// pairing that is no longer current (cancelled or replaced) are ignored.
    pub fn handle_pair_event(&self, id: u64, event: PairEvent) -> Option<PairingEnded> {
        let mut inner = self.lock();
        if inner.pairing.as_ref().map(|p| p.id) != Some(id) {
            return None;
        }
        match event {
            PairEvent::Code {
                user_code,
                link,
                expires_in,
            } => {
                if let Some(slot) = inner.pairing.as_mut() {
                    slot.view = Some(PairingView {
                        user_code,
                        link,
                        expires_in,
                    });
                }
                None
            }
            PairEvent::Approved { .. } => {
                inner.pairing = None;
                inner.settings.sharing_wanted = true;
                inner.start_failed = None;
                // The credentials are already on disk; a failed settings write only means the
                // intent is not remembered, and the node still starts below.
                let _ = self.save(&inner.settings);
                drop(inner);
                self.start_node();
                Some(PairingEnded::Approved)
            }
            PairEvent::Denied => {
                inner.pairing = None;
                Some(PairingEnded::Denied)
            }
            PairEvent::Expired => {
                inner.pairing = None;
                Some(PairingEnded::Expired)
            }
            PairEvent::Error(message) => {
                inner.pairing = None;
                Some(PairingEnded::Failed { message })
            }
        }
    }

    /// Pause (false) or resume (true), and remember the choice.
    pub fn set_sharing(&self, on: bool) -> Result<(), String> {
        {
            let mut inner = self.lock();
            if !inner.settings.consent_is_current() {
                return Err("Please read and accept the consent first.".to_string());
            }
            inner.settings.sharing_wanted = on;
            if on {
                inner.start_failed = None;
            }
            self.save(&inner.settings)?;
        }
        if on {
            self.start_node();
            Ok(())
        } else {
            self.node.stop()
        }
    }

    /// One pass of "keep the node running if the person wants it": called at launch and then
    /// every few seconds. Does nothing without consent, a config, or the wish to share.
    pub fn supervise_once(&self) {
        self.supervise_at(Instant::now());
    }

    fn supervise_at(&self, now: Instant) {
        {
            let inner = self.lock();
            if !inner.settings.consent_is_current() || !inner.settings.sharing_wanted {
                return;
            }
            if let Some(last) = inner.last_start_attempt {
                if inner.start_failed.is_some() && now.duration_since(last) < START_RETRY_COOLDOWN {
                    return;
                }
            }
        }
        let Ok(facts) = self.node.status() else {
            return;
        };
        if !facts.config_present {
            return;
        }
        if facts.process_running {
            self.lock().start_failed = None;
            return;
        }
        self.start_node_at(now);
    }

    fn start_node(&self) {
        self.start_node_at(Instant::now());
    }

    fn start_node_at(&self, now: Instant) {
        let result = self.node.start();
        let mut inner = self.lock();
        inner.last_start_attempt = Some(now);
        inner.start_failed = result.err();
    }

    /// The app is closing: stop sharing, and stop waiting on any pairing. The saved intent is
    /// left alone, so the next launch resumes what the person had.
    pub fn shutdown(&self) {
        self.cancel_pairing();
        let _ = self.node.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;

    /// A scripted node.
    struct FakeNode {
        facts: Mutex<Result<NodeFacts, String>>,
        start_result: Mutex<Result<(), String>>,
        pair_events: Mutex<Vec<PairEvent>>,
        status_calls: AtomicUsize,
        starts: AtomicUsize,
        stops: AtomicUsize,
        pairs: AtomicUsize,
    }

    impl FakeNode {
        fn new() -> Self {
            FakeNode {
                facts: Mutex::new(Ok(NodeFacts::default())),
                start_result: Mutex::new(Ok(())),
                pair_events: Mutex::new(Vec::new()),
                status_calls: AtomicUsize::new(0),
                starts: AtomicUsize::new(0),
                stops: AtomicUsize::new(0),
                pairs: AtomicUsize::new(0),
            }
        }
    }

    impl NodeControl for std::sync::Arc<FakeNode> {
        fn status(&self) -> Result<NodeFacts, String> {
            self.status_calls.fetch_add(1, Ordering::SeqCst);
            self.facts.lock().unwrap().clone()
        }
        fn start(&self) -> Result<(), String> {
            self.starts.fetch_add(1, Ordering::SeqCst);
            self.start_result.lock().unwrap().clone()
        }
        fn stop(&self) -> Result<(), String> {
            self.stops.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
        fn pair(&self) -> Result<(PairingProcess, Receiver<PairEvent>), String> {
            self.pairs.fetch_add(1, Ordering::SeqCst);
            let (tx, rx) = mpsc::channel();
            for e in self.pair_events.lock().unwrap().drain(..) {
                tx.send(e).unwrap();
            }
            // Keep the sender alive so the stream stays open like a real process.
            std::mem::forget(tx);
            Ok((PairingProcess::detached(), rx))
        }
    }

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(label: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            TempDir(std::env::temp_dir().join(format!(
                "provider-app-core-{label}-{}-{nanos}",
                std::process::id()
            )))
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    type Core = AppCore<std::sync::Arc<FakeNode>>;

    fn core(label: &str) -> (Core, std::sync::Arc<FakeNode>, TempDir) {
        let dir = TempDir::new(label);
        let node = std::sync::Arc::new(FakeNode::new());
        (AppCore::new(node.clone(), dir.0.clone()), node, dir)
    }

    fn consented(label: &str) -> (Core, std::sync::Arc<FakeNode>, TempDir) {
        let (c, n, d) = core(label);
        c.accept_consent(1).unwrap();
        (c, n, d)
    }

    fn paired_facts(running: bool, tunnel: bool) -> NodeFacts {
        NodeFacts {
            config_present: true,
            process_running: running,
            tunnel_connected: tunnel,
            ..NodeFacts::default()
        }
    }

    fn code() -> PairEvent {
        PairEvent::Code {
            user_code: "BCDF-GHJK".into(),
            link: "https://proxyhubb.com/dashboard/provider/pair?code=BCDF-GHJK".into(),
            expires_in: 600,
        }
    }

    #[test]
    fn a_fresh_install_needs_consent_and_does_not_even_look_at_the_node() {
        let (c, node, _d) = core("fresh");
        assert_eq!(c.state(), AppState::NeedsConsent);
        assert_eq!(node.status_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn consent_is_remembered_across_launches() {
        let (c, node, d) = core("remember");
        c.accept_consent(5).unwrap();
        assert_eq!(c.state(), AppState::NeedsPairing);
        let again = AppCore::new(node, d.0.clone());
        assert_ne!(again.state(), AppState::NeedsConsent);
    }

    #[test]
    fn pairing_and_sharing_are_refused_without_consent() {
        let (c, node, _d) = core("noconsent");
        assert!(c.begin_pairing().is_err());
        assert!(c.set_sharing(true).is_err());
        assert_eq!(node.pairs.load(Ordering::SeqCst), 0);
        assert_eq!(node.starts.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn the_code_appears_in_the_state_and_cancelling_removes_it() {
        let (c, _node, _d) = consented("code");
        let (id, _rx) = c.begin_pairing().unwrap().unwrap();
        assert_eq!(c.state(), AppState::NeedsPairing, "no code yet");
        assert_eq!(c.handle_pair_event(id, code()), None);
        match c.state() {
            AppState::Pairing {
                user_code,
                expires_in,
                ..
            } => {
                assert_eq!((user_code.as_str(), expires_in), ("BCDF-GHJK", 600));
            }
            other => panic!("{other:?}"),
        }
        c.cancel_pairing();
        assert_eq!(c.state(), AppState::NeedsPairing);
    }

    #[test]
    fn a_second_begin_while_one_is_running_does_not_start_another() {
        let (c, node, _d) = consented("idempotent");
        assert!(c.begin_pairing().unwrap().is_some());
        assert!(c.begin_pairing().unwrap().is_none());
        assert_eq!(node.pairs.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn approval_remembers_the_wish_starts_the_node_and_ends_in_sharing() {
        let (c, node, d) = consented("approve");
        let (id, _rx) = c.begin_pairing().unwrap().unwrap();
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));

        let ended = c.handle_pair_event(
            id,
            PairEvent::Approved {
                node_id: "n".into(),
            },
        );
        assert_eq!(ended, Some(PairingEnded::Approved));
        assert_eq!(node.starts.load(Ordering::SeqCst), 1);
        assert!(matches!(c.state(), AppState::Sharing { .. }));
        // Remembered on disk.
        assert!(settings::load(&d.0).sharing_wanted);
    }

    #[test]
    fn approval_followed_by_a_failed_start_is_a_problem_not_a_silent_pause() {
        let (c, node, _d) = consented("approve-fail");
        let (id, _rx) = c.begin_pairing().unwrap().unwrap();
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        *node.start_result.lock().unwrap() =
            Err("The node did not start. Please try again.".into());

        assert_eq!(
            c.handle_pair_event(
                id,
                PairEvent::Approved {
                    node_id: "n".into()
                }
            ),
            Some(PairingEnded::Approved)
        );
        assert_eq!(
            c.state(),
            AppState::Problem {
                reason: "The node did not start. Please try again.".into()
            }
        );
    }

    #[test]
    fn a_denied_expired_or_failed_pairing_clears_it_and_changes_nothing_else() {
        for (event, want) in [
            (PairEvent::Denied, PairingEnded::Denied),
            (PairEvent::Expired, PairingEnded::Expired),
            (
                PairEvent::Error("boom".into()),
                PairingEnded::Failed {
                    message: "boom".into(),
                },
            ),
        ] {
            let (c, node, d) = consented("ended");
            let (id, _rx) = c.begin_pairing().unwrap().unwrap();
            assert_eq!(c.handle_pair_event(id, event), Some(want));
            assert_eq!(c.state(), AppState::NeedsPairing);
            assert_eq!(node.starts.load(Ordering::SeqCst), 0, "nothing may start");
            assert!(!settings::load(&d.0).sharing_wanted);
        }
    }

    #[test]
    fn a_late_event_from_a_cancelled_pairing_cannot_disturb_a_newer_one() {
        let (c, _node, _d) = consented("stale");
        let (old, _rx1) = c.begin_pairing().unwrap().unwrap();
        c.cancel_pairing();
        let (new, _rx2) = c.begin_pairing().unwrap().unwrap();
        assert_ne!(old, new);
        c.handle_pair_event(new, code());

        // The killed process of the first pairing reports an error after the fact.
        assert_eq!(
            c.handle_pair_event(old, PairEvent::Error("stopped".into())),
            None
        );
        assert_eq!(
            c.handle_pair_event(
                old,
                PairEvent::Approved {
                    node_id: "x".into()
                }
            ),
            None
        );
        assert!(
            matches!(c.state(), AppState::Pairing { .. }),
            "the new pairing is intact"
        );
    }

    #[test]
    fn pausing_stops_the_node_and_is_remembered() {
        let (c, node, d) = consented("pause");
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        c.set_sharing(true).unwrap();
        c.set_sharing(false).unwrap();
        assert_eq!(node.stops.load(Ordering::SeqCst), 1);
        assert_eq!(c.state(), AppState::Paused);
        assert!(!settings::load(&d.0).sharing_wanted);
    }

    #[test]
    fn resuming_with_a_failing_start_shows_the_problem() {
        let (c, node, _d) = consented("resume-fail");
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        *node.start_result.lock().unwrap() = Err("could not start".into());
        c.set_sharing(true).unwrap();
        assert_eq!(
            c.state(),
            AppState::Problem {
                reason: "could not start".into()
            }
        );
    }

    #[test]
    fn a_node_status_error_is_a_problem_with_its_reason() {
        let (c, node, _d) = consented("status-err");
        *node.facts.lock().unwrap() = Err("bundled provider-node not found".into());
        assert_eq!(
            c.state(),
            AppState::Problem {
                reason: "bundled provider-node not found".into()
            }
        );
    }

    #[test]
    fn the_supervisor_resumes_a_wanted_node_that_is_not_running() {
        let (c, node, _d) = consented("sup-resume");
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        c.set_sharing(true).unwrap(); // wanted; the start attempt succeeds
        let before = node.starts.load(Ordering::SeqCst);
        c.supervise_at(Instant::now() + Duration::from_secs(60));
        assert_eq!(
            node.starts.load(Ordering::SeqCst),
            before + 1,
            "it was not running, so start it"
        );
    }

    #[test]
    fn the_supervisor_does_nothing_without_consent_a_config_or_the_wish_to_share() {
        // No consent.
        let (c, node, _d) = core("sup-noconsent");
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        c.supervise_once();
        assert_eq!(node.starts.load(Ordering::SeqCst), 0);

        // Consent but not wanted.
        let (c, node, _d) = consented("sup-notwanted");
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        c.supervise_once();
        assert_eq!(node.starts.load(Ordering::SeqCst), 0);

        // Wanted but never paired (no config).
        let (c, node, _d) = consented("sup-noconfig");
        c.set_sharing(true).unwrap();
        let before = node.starts.load(Ordering::SeqCst);
        *node.facts.lock().unwrap() = Ok(NodeFacts::default());
        c.supervise_at(Instant::now() + Duration::from_secs(60));
        assert_eq!(node.starts.load(Ordering::SeqCst), before);
    }

    #[test]
    fn a_failing_start_is_retried_only_after_the_cooldown() {
        let (c, node, _d) = consented("sup-cooldown");
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        *node.start_result.lock().unwrap() = Err("nope".into());
        c.set_sharing(true).unwrap(); // first attempt fails
        let base = Instant::now();
        let after_first = node.starts.load(Ordering::SeqCst);

        c.supervise_at(base + Duration::from_secs(5));
        assert_eq!(
            node.starts.load(Ordering::SeqCst),
            after_first,
            "inside the cooldown"
        );
        c.supervise_at(base + START_RETRY_COOLDOWN + Duration::from_secs(5));
        assert_eq!(
            node.starts.load(Ordering::SeqCst),
            after_first + 1,
            "after the cooldown"
        );
    }

    #[test]
    fn a_node_that_is_running_clears_an_old_start_failure() {
        let (c, node, _d) = consented("sup-recover");
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        *node.start_result.lock().unwrap() = Err("nope".into());
        c.set_sharing(true).unwrap();
        assert!(matches!(c.state(), AppState::Problem { .. }));

        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        c.supervise_at(Instant::now() + Duration::from_secs(60));
        assert!(matches!(c.state(), AppState::Sharing { .. }));
    }

    #[test]
    fn shutdown_stops_the_node_and_pairing_but_keeps_the_wish_to_share() {
        let (c, node, d) = consented("shutdown");
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        c.set_sharing(true).unwrap();
        c.begin_pairing().unwrap();
        c.shutdown();
        assert_eq!(node.stops.load(Ordering::SeqCst), 1);
        assert!(
            settings::load(&d.0).sharing_wanted,
            "the next launch resumes"
        );
        assert!(
            c.begin_pairing().unwrap().is_some(),
            "pairing slot was released"
        );
    }
}
