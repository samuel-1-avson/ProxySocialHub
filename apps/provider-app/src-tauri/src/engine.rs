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
    /// The person pressed Pause and the node has not been seen stopped yet. While it is set, a
    /// node that is still running is not read as a wish to share (see `remember_running_node`).
    /// In memory only: it only bridges the moment between saving the pause and the stop landing.
    pause_requested: bool,
    /// The app itself started the running node this session. A node that was already running
    /// (the CLI, a service) is adopted, shown, but never stopped: Pause and Quit leave it
    /// to its owner. Set when a start is issued from stopped, cleared on failure and
    /// whenever the node is seen stopped.
    started_by_app: bool,
}

pub struct AppCore<N: NodeControl> {
    node: N,
    settings_dir: PathBuf,
    inner: Mutex<Inner>,
    /// Held while the node is being started or stopped. A Pause that arrives while a start is
    /// still in flight (from the tray, or a second click) waits for it and then stops the node;
    /// without this it could stop nothing, find no node yet, and leave the node running just
    /// after the person paused. Never held together with `inner`.
    node_ops: Mutex<()>,
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
            node_ops: Mutex::new(()),
        }
    }

    fn node_start(&self) -> Result<(), String> {
        let _one_at_a_time = self.node_ops.lock().unwrap_or_else(|e| e.into_inner());
        self.node.start()
    }

    fn node_stop(&self) -> Result<(), String> {
        let _one_at_a_time = self.node_ops.lock().unwrap_or_else(|e| e.into_inner());
        self.node.stop()
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
                let mut inner = self.lock();
                if !facts.process_running {
                    inner.started_by_app = false;
                }
                facts.externally_started = facts.process_running && !inner.started_by_app;
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
                inner.pause_requested = false;
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
            inner.pause_requested = !on;
            if on {
                inner.start_failed = None;
            }
            self.save(&inner.settings)?;
        }
        if on {
            self.start_node();
            Ok(())
        } else if self.lock().started_by_app {
            self.node_stop()
        } else {
            // An adopted node belongs to its owner; the wish is saved, the node untouched.
            Ok(())
        }
    }

    /// One pass of "keep the node running if the person wants it": called at launch and then
    /// every few seconds. Does nothing without consent or a config. Without the wish to share it
    /// starts nothing, but it does notice a node the person started themselves.
    pub fn supervise_once(&self) {
        self.supervise_at(Instant::now());
    }

    fn supervise_at(&self, now: Instant) {
        {
            let inner = self.lock();
            if !inner.settings.consent_is_current() {
                return;
            }
            if !inner.settings.sharing_wanted {
                drop(inner);
                self.remember_running_node();
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
        self.lock().started_by_app = false;
        self.start_node_at(now);
    }

    /// A node the person started themselves (the CLI, or the website's setup script) is running
    /// and the window shows it as Sharing, but nothing ever saved the wish to share. Without
    /// this the app resumes nothing after a restart and sits Paused while the person believes
    /// they are sharing. Start nothing, change nothing about the node: just remember the wish.
    ///
    /// Only with consent (checked again under the lock, since the status call runs outside it),
    /// only for a running node with a config the app can see, and never while a Pause is still
    /// taking effect: Pause saves "not wanted" before the node has stopped, and that moment
    /// must not read as a wish to share.
    fn remember_running_node(&self) {
        let Ok(facts) = self.node.status() else {
            return;
        };
        let mut inner = self.lock();
        if inner.pause_requested {
            // The pause has landed once the node is seen stopped; until then leave it alone.
            if !facts.process_running {
                inner.pause_requested = false;
            }
            return;
        }
        if !inner.settings.consent_is_current()
            || inner.settings.sharing_wanted
            || !facts.config_present
            || !facts.process_running
        {
            return;
        }
        inner.settings.sharing_wanted = true;
        // As on approval, a failed write only means the wish is not remembered across a restart.
        let _ = self.save(&inner.settings);
    }

    fn start_node(&self) {
        self.start_node_at(Instant::now());
    }

    fn start_node_at(&self, now: Instant) {
        // A node that is already running belongs to someone else (the CLI, a service). The
        // start below is still issued -- `start --background` reports AlreadyRunning for that
        // case -- but the node is adopted, not owned: Pause and Quit must not stop it.
        let already_running = matches!(self.node.status(), Ok(facts) if facts.process_running);
        if !already_running {
            // Optimistic, so a Pause landing mid-start still stops what we started.
            self.lock().started_by_app = true;
        }
        let result = self.node_start();
        let mut inner = self.lock();
        inner.last_start_attempt = Some(now);
        inner.start_failed = result.as_ref().err().cloned();
        if already_running || result.is_err() {
            inner.started_by_app = false;
        }
    }

    /// The app is closing: stop a node the app itself started, and stop waiting on any
    /// pairing. A node started elsewhere (the CLI) keeps running for its owner. The saved
    /// intent is left alone, so the next launch resumes what the person had.
    pub fn shutdown(&self) {
        self.cancel_pairing();
        if self.lock().started_by_app {
            let _ = self.node_stop();
        }
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
        /// What happened to the node, in order.
        events: Mutex<Vec<&'static str>>,
        /// How long a start takes to return.
        start_delay: Mutex<Duration>,
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
                events: Mutex::new(Vec::new()),
                start_delay: Mutex::new(Duration::ZERO),
            }
        }
    }

    impl NodeControl for std::sync::Arc<FakeNode> {
        fn status(&self) -> Result<NodeFacts, String> {
            self.status_calls.fetch_add(1, Ordering::SeqCst);
            self.facts.lock().unwrap().clone()
        }
        fn start(&self) -> Result<(), String> {
            self.events.lock().unwrap().push("start-begin");
            self.starts.fetch_add(1, Ordering::SeqCst);
            let delay = *self.start_delay.lock().unwrap();
            std::thread::sleep(delay);
            self.events.lock().unwrap().push("start-end");
            self.start_result.lock().unwrap().clone()
        }
        fn stop(&self) -> Result<(), String> {
            self.events.lock().unwrap().push("stop");
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

    /// A Pause that arrives while a start is still in flight must wait for it and then stop the
    /// node. Without the guard it ran first, found nothing to stop, and the node came up just
    /// after the person had paused.
    #[test]
    fn a_pause_during_a_start_waits_for_it_and_then_stops_the_node() {
        let (c, node, d) = consented("pause-during-start");
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        *node.start_delay.lock().unwrap() = Duration::from_millis(400);

        std::thread::scope(|s| {
            let resume = s.spawn(|| c.set_sharing(true).unwrap());
            std::thread::sleep(Duration::from_millis(100)); // the start is now in flight
            c.set_sharing(false).unwrap();
            resume.join().unwrap();
        });

        assert_eq!(
            *node.events.lock().unwrap(),
            vec!["start-begin", "start-end", "stop"],
            "the stop must come after the start finished"
        );
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
    fn shutdown_stops_a_node_the_app_started_and_keeps_the_wish_to_share() {
        let (c, node, d) = consented("shutdown");
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        c.set_sharing(true).unwrap(); // the app starts it
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
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

    // ── a node the person started themselves (the CLI, or the website's setup script) ──

    /// What actually happened: the app was installed over a node that was already running,
    /// showed "Sharing is on", and after a reboot sat Paused because the wish was never saved.
    #[test]
    fn a_node_started_outside_the_app_is_remembered_so_a_reboot_resumes_it() {
        let (c, node, d) = consented("adopt");
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        assert!(matches!(c.state(), AppState::Sharing { .. }));
        assert!(!settings::load(&d.0).sharing_wanted, "nothing chose it yet");

        c.supervise_once();
        assert!(settings::load(&d.0).sharing_wanted, "remembered on disk");
        assert_eq!(
            node.starts.load(Ordering::SeqCst),
            0,
            "it was already running, so nothing is started"
        );

        // The next launch, after the machine restarted and the node is gone.
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        let relaunched = AppCore::new(node.clone(), d.0.clone());
        relaunched.supervise_at(Instant::now() + Duration::from_secs(60));
        assert_eq!(
            node.starts.load(Ordering::SeqCst),
            1,
            "the relaunched app resumes sharing"
        );
    }

    #[test]
    fn shutdown_leaves_a_node_started_outside_the_app_running() {
        let (c, node, _d) = consented("shutdown-adopted");
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        c.set_sharing(true).unwrap(); // adopts the running CLI node
        c.shutdown();
        assert_eq!(
            node.stops.load(Ordering::SeqCst),
            0,
            "quitting the app must not stop a CLI node"
        );
    }

    #[test]
    fn pausing_an_adopted_node_leaves_it_running_and_says_so() {
        let (c, node, d) = consented("pause-adopted");
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        c.set_sharing(true).unwrap();
        c.set_sharing(false).unwrap();
        assert_eq!(node.stops.load(Ordering::SeqCst), 0);
        assert!(
            !settings::load(&d.0).sharing_wanted,
            "the wish is still saved"
        );
        match c.state() {
            AppState::Sharing {
                managed_externally, ..
            } => assert!(managed_externally, "the UI must explain who owns it"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_running_node_is_never_adopted_without_consent() {
        let (c, node, d) = core("adopt-noconsent");
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        c.supervise_once();
        assert!(!settings::load(&d.0).sharing_wanted);
        assert_eq!(c.state(), AppState::NeedsConsent);
        assert_eq!(node.starts.load(Ordering::SeqCst), 0);
    }

    /// The consent wording changed after sharing was turned on: the saved answer is to older
    /// text, so the person must be asked again, and until they answer nothing may start.
    #[test]
    fn outdated_consent_stops_the_supervisor_whatever_was_saved() {
        let dir = TempDir::new("stale-consent");
        settings::save(
            &dir.0,
            &Settings {
                consent: Some(settings::Consent {
                    version: settings::CONSENT_VERSION - 1,
                    accepted_at_unix: 1,
                }),
                sharing_wanted: true,
            },
        )
        .unwrap();
        let node = std::sync::Arc::new(FakeNode::new());
        let c = AppCore::new(node.clone(), dir.0.clone());
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));

        c.supervise_at(Instant::now() + Duration::from_secs(60));
        assert_eq!(node.starts.load(Ordering::SeqCst), 0, "nothing may start");
        assert_eq!(c.state(), AppState::NeedsConsent, "they are asked again");
    }

    #[test]
    fn only_a_running_node_with_a_config_is_adopted() {
        // Not running: the person has not asked for anything, so nothing is turned on.
        let (c, node, d) = consented("adopt-stopped");
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        c.supervise_once();
        assert!(!settings::load(&d.0).sharing_wanted);

        // Running but with no config the app can see: not something it can manage.
        let (c, node, d) = consented("adopt-noconfig");
        *node.facts.lock().unwrap() = Ok(NodeFacts {
            process_running: true,
            ..NodeFacts::default()
        });
        c.supervise_once();
        assert!(!settings::load(&d.0).sharing_wanted);

        // The node cannot be asked at all.
        let (c, node, d) = consented("adopt-error");
        *node.facts.lock().unwrap() = Err("bundled provider-node not found".into());
        c.supervise_once();
        assert!(!settings::load(&d.0).sharing_wanted);
    }

    /// Pause saves "not wanted" and only then stops the node. If the supervisor looks in
    /// between it sees a running node; that must not read as the person wanting to share.
    #[test]
    fn pausing_is_not_undone_while_the_node_is_still_stopping() {
        let (c, node, d) = consented("adopt-pause-race");
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        c.set_sharing(true).unwrap();
        c.set_sharing(false).unwrap();
        let started_before_looking = node.starts.load(Ordering::SeqCst);
        // The fake's stop() does not change its facts: the node is "still shutting down".
        for _ in 0..3 {
            c.supervise_once();
        }
        assert!(!settings::load(&d.0).sharing_wanted, "the pause stands");
        assert_eq!(
            node.starts.load(Ordering::SeqCst),
            started_before_looking,
            "and nothing restarts it"
        );
    }

    #[test]
    fn once_a_pause_has_taken_effect_a_node_started_later_is_adopted_again() {
        let (c, node, d) = consented("adopt-after-pause");
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        c.set_sharing(true).unwrap();
        c.set_sharing(false).unwrap();

        // The node stops; the supervisor sees it stopped, so the pause is fulfilled.
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        c.supervise_once();
        assert!(!settings::load(&d.0).sharing_wanted);

        // The person later starts it by hand again.
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        c.supervise_once();
        assert!(settings::load(&d.0).sharing_wanted);
    }

    #[test]
    fn a_pause_that_cannot_stop_the_node_is_never_overridden() {
        // The node keeps running after Pause. The person said stop, so the app must not turn
        // the wish back on, however many times it looks.
        let (c, node, d) = consented("adopt-pause-stuck");
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        c.set_sharing(true).unwrap();
        c.set_sharing(false).unwrap();
        for _ in 0..10 {
            c.supervise_once();
        }
        assert!(!settings::load(&d.0).sharing_wanted);
    }
}
