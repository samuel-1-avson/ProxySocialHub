//! The app's brain: consent, the sharing intent, pairing, and keeping the node running.
//!
//! It reaches the node only through `NodeControl`, so every behaviour here is tested with a
//! fake; the real `provider-node` is exercised by the end-to-end run.

use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::account::{AccountFacts, AccountSnapshot};
use crate::app_update::{update_notice_for, UpdateNotice};
use crate::diagnosis::Diagnosis;
use crate::disconnect::DisconnectResult;
use crate::node::{PairEvent, PairingProcess, Sidecar};
use crate::node_settings::NodeSettings;
use crate::settings::{self, Settings};
use crate::state::{derive_state, with_remote, AppState, NodeFacts, PairingView};

/// After a failed start, wait this long before trying again.
const START_RETRY_COOLDOWN: Duration = Duration::from_secs(30);

/// How often ProxyHubb's servers are asked about this computer and its earnings. Every ask
/// exchanges the node's key for a token, which the server records, so this is minutes, not
/// seconds; the Refresh button covers the person who wants it now.
const REMOTE_INTERVAL: Duration = Duration::from_secs(5 * 60);
/// After an ask that failed or found the servers unreachable, try again sooner.
const REMOTE_RETRY: Duration = Duration::from_secs(60);
/// The least time between two presses of Refresh.
const REMOTE_FORCE_GAP: Duration = Duration::from_secs(20);
/// Support files kept; older ones are deleted when a new one is made.
const SUPPORT_FILES_KEPT: usize = 5;
const SUPPORT_PREFIX: &str = "support-details-";

/// This app's own version, compared with the newest published installer.
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
/// How often the newest published version is looked up, and how soon after a failed lookup.
const UPDATE_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const UPDATE_RETRY: Duration = Duration::from_secs(30 * 60);
/// Between stopping the node and starting it again, so the old process lets go of its port and
/// PID file (the node's own restart waits the same).
const RESTART_PAUSE: Duration = Duration::from_millis(500);

pub trait NodeControl: Send + Sync + 'static {
    fn status(&self) -> Result<NodeFacts, String>;
    fn start(&self) -> Result<(), String>;
    fn stop(&self) -> Result<(), String>;
    fn pair(&self) -> Result<(PairingProcess, Receiver<PairEvent>), String>;
    /// What ProxyHubb's servers say about this computer. Asks the network; slow.
    fn account(&self) -> Result<AccountFacts, String>;
    /// The node's own checks, in plain words. Asks the network; slow.
    fn diagnose(&self) -> Result<Diagnosis, String>;
    /// Write the support file to `output`.
    fn support_bundle(&self, output: &Path) -> Result<(), String>;
    /// Stop the node and move this computer's settings aside. Slow.
    fn unpair(&self) -> Result<DisconnectResult, String>;
    /// This computer's node settings, for reading.
    fn settings(&self) -> Result<NodeSettings, String>;
    /// The version of the newest published installer. Asks the network; slow.
    fn latest_release(&self) -> Result<String, String>;
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
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
    fn account(&self) -> Result<AccountFacts, String> {
        Sidecar::account(self)
    }
    fn diagnose(&self) -> Result<Diagnosis, String> {
        Sidecar::diagnose(self)
    }
    fn support_bundle(&self, output: &Path) -> Result<(), String> {
        Sidecar::support_bundle(self, output)
    }
    fn unpair(&self) -> Result<DisconnectResult, String> {
        Sidecar::unpair(self)
    }
    fn settings(&self) -> Result<NodeSettings, String> {
        Sidecar::settings(self)
    }
    fn latest_release(&self) -> Result<String, String> {
        Sidecar::latest_release(self)
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
    /// The app itself started the running node this session. A node that was already running
    /// (the CLI, a service) is adopted, shown, but never stopped: Pause and Quit leave it
    /// to its owner. Set when a start is issued from stopped, cleared on failure and
    /// whenever the node is seen stopped.
    started_by_app: bool,
    /// The last answer from ProxyHubb's servers (kept when a later ask fails).
    remote: Option<AccountSnapshot>,
    remote_attempt_at: Option<Instant>,
    /// An ask is running; a second one waits for it instead of starting another process.
    remote_in_flight: bool,
    /// The last ask got an answer, so the next one waits the long interval, not the short one.
    remote_ok: bool,
    /// The last state derived was Sharing. The servers are only asked about a node that is.
    sharing_seen: bool,
    /// A newer installer than this app exists (the last answer; kept when a later lookup fails).
    update: Option<UpdateNotice>,
    update_attempt_at: Option<Instant>,
    update_in_flight: bool,
    /// The last lookup got an answer, so the next waits the long interval, not the short one.
    update_ok: bool,
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
        self.state_given(|| self.node.status())
    }

    /// `state`, with the node's facts supplied by `read` (called only when the node has to be
    /// looked at), so a caller that already has them does not start another process.
    fn state_given(&self, read: impl FnOnce() -> Result<NodeFacts, String>) -> AppState {
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
        match read() {
            Ok(mut facts) => {
                facts.start_failed = start_failed;
                let mut inner = self.lock();
                if !facts.process_running {
                    inner.started_by_app = false;
                }
                facts.externally_started = facts.process_running && !inner.started_by_app;
                let state = derive_state(true, wanted, None, &facts);
                let sharing = matches!(state, AppState::Sharing { .. });
                if sharing && !inner.sharing_seen {
                    // Sharing has just begun (or begun again): whatever was fetched earlier is
                    // old, so ask now instead of waiting out the interval.
                    inner.remote_attempt_at = None;
                }
                inner.sharing_seen = sharing;
                with_remote(state, inner.remote.as_ref())
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
                inner.settings.pause_pending = false;
                inner.start_failed = None;
                // A new pairing is a different computer on the server; what was fetched about the
                // old one is not about this.
                inner.remote = None;
                inner.remote_attempt_at = None;
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
            // Saved to disk, so a Pause that has not taken effect yet (or cannot, for a node
            // that is not the app's) is still a Pause after a restart.
            inner.settings.pause_pending = !on;
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
            // Stopping it is a separate, explicit step: `stop_outside_node`.
            Ok(())
        }
    }

    /// Stop the node whoever started it. The window only offers this after the person has
    /// confirmed, for a node the app did not start; a Pause never reaches such a node. The wish
    /// is turned off first, so the supervisor does not start it again.
    pub fn stop_outside_node(&self) -> Result<(), String> {
        {
            let mut inner = self.lock();
            if !inner.settings.consent_is_current() {
                return Err("Please read and accept the consent first.".to_string());
            }
            inner.settings.sharing_wanted = false;
            inner.settings.pause_pending = true;
            self.save(&inner.settings)?;
        }
        self.node_stop()
    }

    /// One pass of "keep the node running if the person wants it": called at launch and then
    /// every few seconds. Does nothing without consent or a config. Without the wish to share it
    /// starts nothing, but it does notice a node the person started themselves.
    #[cfg(test)]
    pub fn supervise_once(&self) {
        self.supervise_at(Instant::now());
    }

    /// One pass of the supervisor followed by the state to show, from a single look at the node.
    /// The background loop used to run `status` twice per tick (once to supervise, once for the
    /// window); this reads it once. Without consent the node is not looked at at all.
    pub fn tick(&self) -> AppState {
        self.tick_at(Instant::now())
    }

    fn tick_at(&self, now: Instant) -> AppState {
        if !self.lock().settings.consent_is_current() {
            return self.state();
        }
        let read = self.node.status();
        self.supervise_given(now, &read);
        self.state_given(|| read)
    }

    #[cfg(test)]
    fn supervise_at(&self, now: Instant) {
        if !self.lock().settings.consent_is_current() {
            return;
        }
        let read = self.node.status();
        self.supervise_given(now, &read);
    }

    fn supervise_given(&self, now: Instant, read: &Result<NodeFacts, String>) {
        {
            let inner = self.lock();
            if !inner.settings.consent_is_current() {
                return;
            }
            if !inner.settings.sharing_wanted {
                drop(inner);
                self.remember_running_node(read);
                return;
            }
            if let Some(last) = inner.last_start_attempt {
                if inner.start_failed.is_some() && now.duration_since(last) < START_RETRY_COOLDOWN {
                    return;
                }
            }
        }
        let Ok(facts) = read else {
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
    /// pending: Pause saves "not wanted" before the node has stopped (or, for a node the app did
    /// not start, without stopping it), and that must not read as a wish to share, not even after
    /// the app restarts. The pause is over once the node is seen stopped.
    fn remember_running_node(&self, read: &Result<NodeFacts, String>) {
        let Ok(facts) = read else {
            return;
        };
        let mut inner = self.lock();
        if inner.settings.pause_pending {
            if !facts.process_running {
                inner.settings.pause_pending = false;
                // A failed write only means the pause is still pending after a restart.
                let _ = self.save(&inner.settings);
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

    fn require_consent(&self) -> Result<(), String> {
        if self.lock().settings.consent_is_current() {
            Ok(())
        } else {
            Err("Please read and accept the consent first.".to_string())
        }
    }

    /// Ask ProxyHubb's servers about this computer, if it is time (or `force`: the person pressed
    /// Refresh). Returns whether an ask ran, so the caller knows the window has something new.
    /// Does nothing unless the node is sharing: there is nothing to say about a paused one.
    pub fn refresh_remote(&self, force: bool) -> bool {
        self.refresh_remote_at(Instant::now(), unix_now(), force)
    }

    fn refresh_remote_at(&self, now: Instant, unix: u64, force: bool) -> bool {
        {
            let mut inner = self.lock();
            if !inner.settings.consent_is_current() || !inner.sharing_seen || inner.remote_in_flight
            {
                return false;
            }
            let gap = if force {
                REMOTE_FORCE_GAP
            } else if inner.remote_ok {
                REMOTE_INTERVAL
            } else {
                REMOTE_RETRY
            };
            if let Some(last) = inner.remote_attempt_at {
                if now.duration_since(last) < gap {
                    return false;
                }
            }
            inner.remote_in_flight = true;
            inner.remote_attempt_at = Some(now);
        }
        // The ask runs a process and waits on the network: never under the lock.
        let result = self.node.account();
        let mut inner = self.lock();
        inner.remote_in_flight = false;
        match result {
            Ok(facts) => {
                inner.remote_ok = facts.reachable;
                inner.remote = Some(AccountSnapshot {
                    facts,
                    fetched_unix: unix,
                });
            }
            // The process failed: keep the last answer and try again soon.
            Err(_) => inner.remote_ok = false,
        }
        true
    }

    /// "Check my connection": the node's checks, in plain words.
    pub fn diagnose(&self) -> Result<Diagnosis, String> {
        self.require_consent()?;
        self.node.diagnose()
    }

    /// Write the support file into the app's own folder and return where it is. The newest few
    /// are kept.
    pub fn save_support_details(&self) -> Result<PathBuf, String> {
        self.require_consent()?;
        let dir = self.settings_dir.join("support");
        std::fs::create_dir_all(&dir)
            .map_err(|_| "The support file could not be made.".to_string())?;
        let file = dir.join(format!("{SUPPORT_PREFIX}{}.json", unix_now()));
        self.node.support_bundle(&file)?;
        prune_support_files(&dir, SUPPORT_FILES_KEPT);
        Ok(file)
    }

    /// Stop the node and start it again (the Restart button, for a node stuck connecting).
    ///
    /// Only a node this app started: one started elsewhere belongs to its owner, and stopping it
    /// is a separate, confirmed step (`stop_outside_node`). A restart is a wish to share, so it
    /// also ends a pending pause.
    pub fn restart_node(&self) -> Result<(), String> {
        self.require_consent()?;
        let facts = self.node.status()?;
        if !facts.config_present {
            return Err("This computer is not connected to an account yet.".to_string());
        }
        if facts.process_running && !self.lock().started_by_app {
            return Err(
                "This node was started outside this app, so the app will not restart it. Stop it first, then press Resume sharing."
                    .to_string(),
            );
        }
        {
            let mut inner = self.lock();
            inner.settings.sharing_wanted = true;
            inner.settings.pause_pending = false;
            inner.start_failed = None;
            // Optimistic, as in `start_node_at`, so a Pause landing mid-restart still stops it.
            inner.started_by_app = true;
            self.save(&inner.settings)?;
        }
        // One hold across both steps: a Pause arriving between them waits, and the supervisor
        // cannot start a second node in the gap.
        let result = {
            let _one_at_a_time = self.node_ops.lock().unwrap_or_else(|e| e.into_inner());
            let stopped = self.node.stop();
            std::thread::sleep(RESTART_PAUSE);
            stopped.and_then(|()| self.node.start())
        };
        let mut inner = self.lock();
        inner.last_start_attempt = Some(Instant::now());
        inner.start_failed = result.as_ref().err().cloned();
        if result.is_err() {
            inner.started_by_app = false;
        }
        result
    }

    /// Disconnect this computer from its account: the node is stopped and its settings are moved
    /// aside (kept, not deleted). The key is NOT revoked: a node cannot do that, so the caller
    /// tells the person to revoke the token in the dashboard.
    ///
    /// The wish to share is turned off first so the supervisor does not start the node again
    /// meanwhile. If the disconnect fails nothing was disconnected, and the wish goes back to
    /// what it was.
    pub fn disconnect(&self) -> Result<DisconnectResult, String> {
        self.require_consent()?;
        let was_wanted = {
            let mut inner = self.lock();
            let was = inner.settings.sharing_wanted;
            inner.settings.sharing_wanted = false;
            inner.settings.pause_pending = true;
            self.save(&inner.settings)?;
            was
        };
        let result = {
            let _one_at_a_time = self.node_ops.lock().unwrap_or_else(|e| e.into_inner());
            self.node.unpair()
        };
        let mut inner = self.lock();
        inner.settings.pause_pending = false;
        match result {
            Ok(done) => {
                inner.started_by_app = false;
                inner.start_failed = None;
                // Whatever was fetched was about the account this computer just left.
                inner.remote = None;
                inner.remote_attempt_at = None;
                let _ = self.save(&inner.settings);
                Ok(done)
            }
            Err(reason) => {
                inner.settings.sharing_wanted = was_wanted;
                let _ = self.save(&inner.settings);
                Err(reason)
            }
        }
    }

    /// This computer's node settings, for reading.
    pub fn node_settings(&self) -> Result<NodeSettings, String> {
        self.require_consent()?;
        self.node.settings()
    }

    /// The notice to show, if a newer installer than this app exists.
    pub fn update_notice(&self) -> Option<UpdateNotice> {
        self.lock().update.clone()
    }

    /// Look up the newest published installer, if it is time (at start, then every few hours).
    /// Returns whether the notice changed, so the caller knows to tell the window.
    pub fn refresh_update(&self) -> bool {
        self.refresh_update_at(Instant::now(), APP_VERSION)
    }

    fn refresh_update_at(&self, now: Instant, current: &str) -> bool {
        {
            let mut inner = self.lock();
            if !inner.settings.consent_is_current() || inner.update_in_flight {
                return false;
            }
            let gap = if inner.update_ok {
                UPDATE_INTERVAL
            } else {
                UPDATE_RETRY
            };
            if let Some(last) = inner.update_attempt_at {
                if now.duration_since(last) < gap {
                    return false;
                }
            }
            inner.update_in_flight = true;
            inner.update_attempt_at = Some(now);
        }
        // The lookup runs a process and waits on the network: never under the lock.
        let result = self.node.latest_release();
        let mut inner = self.lock();
        inner.update_in_flight = false;
        match result {
            Ok(latest) => {
                inner.update_ok = true;
                let notice = update_notice_for(current, &latest);
                let changed = notice != inner.update;
                inner.update = notice;
                changed
            }
            // The lookup failed: keep what was known and try again in a while.
            Err(_) => {
                inner.update_ok = false;
                false
            }
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

/// Delete all but the newest `keep` support files in `dir`. Their names carry the time they were
/// made (equal-width seconds), so name order is time order. Nothing else in the folder is touched.
fn prune_support_files(dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(SUPPORT_PREFIX) && n.ends_with(".json"))
        })
        .collect();
    files.sort();
    let excess = files.len().saturating_sub(keep);
    for old in files.into_iter().take(excess) {
        let _ = std::fs::remove_file(old);
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
        account_result: Mutex<Result<AccountFacts, String>>,
        accounts: AtomicUsize,
        diagnosis_result: Mutex<Result<Diagnosis, String>>,
        bundle_result: Mutex<Result<(), String>>,
        bundles: AtomicUsize,
        unpair_result: Mutex<Result<DisconnectResult, String>>,
        unpairs: AtomicUsize,
        /// Where the app's settings.json is, so `unpair` can record what it said at that moment.
        watch_dir: Mutex<Option<PathBuf>>,
        /// (sharing_wanted, pause_pending) as saved while `unpair` was running.
        seen_during_unpair: Mutex<Option<(bool, bool)>>,
        settings_result: Mutex<Result<NodeSettings, String>>,
        latest_result: Mutex<Result<String, String>>,
        latest_calls: AtomicUsize,
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
                account_result: Mutex::new(Ok(online_account())),
                accounts: AtomicUsize::new(0),
                diagnosis_result: Mutex::new(Ok(Diagnosis { findings: vec![] })),
                bundle_result: Mutex::new(Ok(())),
                bundles: AtomicUsize::new(0),
                unpair_result: Mutex::new(Ok(DisconnectResult {
                    archived_config: Some("C:/p/provider.toml.disconnected-1".into()),
                })),
                unpairs: AtomicUsize::new(0),
                watch_dir: Mutex::new(None),
                seen_during_unpair: Mutex::new(None),
                settings_result: Mutex::new(Ok(crate::node_settings::parse_node_settings(
                    r#"{"gateways":["gw:3128"],"transport":"yamux","use_tls":true,
                        "max_connections":500,"bandwidth_limit_mbps":100,
                        "allowed_ports":[80,443],"connection_type":"residential"}"#,
                )
                .unwrap())),
                latest_result: Mutex::new(Ok("0.1.2".into())),
                latest_calls: AtomicUsize::new(0),
            }
        }
    }

    fn online_account() -> AccountFacts {
        crate::account::parse_account(
            r#"{"reachable":true,"node":{"status":"online"},
                "earnings":{"last_7_days_sol":0.1,"last_30_days_sol":0.4,"pending_sol":0.25,"paid_sol":1.0}}"#,
        )
        .unwrap()
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
        fn account(&self) -> Result<AccountFacts, String> {
            self.accounts.fetch_add(1, Ordering::SeqCst);
            self.account_result.lock().unwrap().clone()
        }
        fn diagnose(&self) -> Result<Diagnosis, String> {
            self.diagnosis_result.lock().unwrap().clone()
        }
        fn support_bundle(&self, output: &Path) -> Result<(), String> {
            self.bundles.fetch_add(1, Ordering::SeqCst);
            let result = self.bundle_result.lock().unwrap().clone();
            if result.is_ok() {
                std::fs::write(output, "{}").map_err(|e| e.to_string())?;
            }
            result
        }
        fn unpair(&self) -> Result<DisconnectResult, String> {
            self.unpairs.fetch_add(1, Ordering::SeqCst);
            self.events.lock().unwrap().push("unpair");
            if let Some(dir) = self.watch_dir.lock().unwrap().clone() {
                let s = settings::load(&dir);
                *self.seen_during_unpair.lock().unwrap() =
                    Some((s.sharing_wanted, s.pause_pending));
            }
            self.unpair_result.lock().unwrap().clone()
        }
        fn settings(&self) -> Result<NodeSettings, String> {
            self.settings_result.lock().unwrap().clone()
        }
        fn latest_release(&self) -> Result<String, String> {
            self.latest_calls.fetch_add(1, Ordering::SeqCst);
            self.latest_result.lock().unwrap().clone()
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

    /// A Pause whose stop did not land (the node is still running afterwards) must survive a
    /// relaunch. Before the fix, the relaunched app read the running node as a wish to share and
    /// turned the pause back on, so the window said "Sharing is on" after the person paused.
    #[test]
    fn a_pause_whose_stop_did_not_land_survives_a_relaunch() {
        let (c, node, d) = consented("pause-survives");
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        c.set_sharing(true).unwrap(); // the app starts the node
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true)); // it comes up
        c.set_sharing(false).unwrap(); // Pause; the node is still running afterwards

        let relaunched = AppCore::new(node.clone(), d.0.clone());
        relaunched.supervise_once();
        assert!(
            !settings::load(&d.0).sharing_wanted,
            "the relaunch must not turn the pause back on"
        );
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
                pause_pending: false,
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

    /// The pause is over once the node has been seen stopped, and that is remembered too: a node
    /// the person starts by hand after that is adopted again, even in a later launch.
    #[test]
    fn a_pause_that_has_landed_is_forgotten_on_disk_too() {
        let (c, node, d) = consented("pause-lands");
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        c.set_sharing(true).unwrap();
        c.set_sharing(false).unwrap();
        assert!(settings::load(&d.0).pause_pending, "pending until it lands");

        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        c.supervise_once();
        assert!(!settings::load(&d.0).pause_pending, "landed");

        let relaunched = AppCore::new(node.clone(), d.0.clone());
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        relaunched.supervise_once();
        assert!(settings::load(&d.0).sharing_wanted, "adopted again");
    }

    #[test]
    fn resuming_clears_a_pending_pause() {
        let (c, node, d) = consented("resume-clears");
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        c.set_sharing(false).unwrap();
        assert!(settings::load(&d.0).pause_pending);
        c.set_sharing(true).unwrap();
        let s = settings::load(&d.0);
        assert!(s.sharing_wanted && !s.pause_pending);
    }

    /// A Pause never stops a node the app did not start; this is the explicit way to do it.
    #[test]
    fn stopping_a_node_started_outside_the_app_stops_it_and_keeps_it_stopped() {
        let (c, node, d) = consented("stop-outside");
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        c.supervise_once(); // adopts the running node: the wish is now on
        assert!(settings::load(&d.0).sharing_wanted);

        c.stop_outside_node().unwrap();
        assert_eq!(node.stops.load(Ordering::SeqCst), 1);
        let s = settings::load(&d.0);
        assert!(!s.sharing_wanted && s.pause_pending);

        // The node is still shutting down: it is neither restarted nor adopted again.
        for _ in 0..3 {
            c.supervise_once();
        }
        assert_eq!(node.starts.load(Ordering::SeqCst), 0);
        assert!(!settings::load(&d.0).sharing_wanted);
    }

    #[test]
    fn stopping_an_outside_node_needs_consent() {
        let (c, node, _d) = core("stop-outside-noconsent");
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        assert!(c.stop_outside_node().is_err());
        assert_eq!(node.stops.load(Ordering::SeqCst), 0);
    }

    /// The background loop used to ask the node twice per tick: once to supervise and once for
    /// the window. One look serves both.
    #[test]
    fn a_tick_looks_at_the_node_once_and_returns_what_the_window_shows() {
        let (c, node, _d) = consented("tick-once");
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        let before = node.status_calls.load(Ordering::SeqCst);
        let state = c.tick();
        assert_eq!(node.status_calls.load(Ordering::SeqCst) - before, 1);
        assert!(matches!(state, AppState::Sharing { .. }));
    }

    #[test]
    fn a_tick_without_consent_does_not_look_at_the_node() {
        let (c, node, _d) = core("tick-noconsent");
        assert_eq!(c.tick(), AppState::NeedsConsent);
        assert_eq!(node.status_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_tick_still_resumes_a_wanted_node_that_is_not_running() {
        let (c, node, _d) = consented("tick-resume");
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        c.set_sharing(true).unwrap();
        let before = node.starts.load(Ordering::SeqCst);
        let state = c.tick_at(Instant::now() + Duration::from_secs(60));
        assert_eq!(node.starts.load(Ordering::SeqCst), before + 1);
        assert!(matches!(state, AppState::Connecting { .. }), "{state:?}");
    }

    // ── what ProxyHubb's servers say (earnings, "online") ─────────────────────

    fn sharing_core(label: &str) -> (Core, std::sync::Arc<FakeNode>, TempDir) {
        let (c, node, d) = consented(label);
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        c.tick(); // the engine now knows the node is sharing
        (c, node, d)
    }

    fn server_of(state: &AppState) -> crate::account::ServerView {
        match state {
            AppState::Sharing { details, .. } => details.remote.server,
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_servers_are_asked_only_about_a_node_that_is_sharing() {
        let (c, node, _d) = consented("remote-paused");
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        c.tick();
        assert!(!c.refresh_remote_at(Instant::now(), 1, false));
        assert!(
            !c.refresh_remote_at(Instant::now(), 1, true),
            "not even on request"
        );
        assert_eq!(node.accounts.load(Ordering::SeqCst), 0);

        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        c.tick();
        assert!(c.refresh_remote_at(Instant::now(), 1, false));
        assert_eq!(node.accounts.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn the_answer_shows_on_the_sharing_state_and_before_it_the_window_says_checking() {
        use crate::account::ServerView;
        let (c, _node, _d) = sharing_core("remote-shows");
        assert_eq!(server_of(&c.state()), ServerView::Checking);

        assert!(c.refresh_remote_at(Instant::now(), 1_700_000_000, false));
        match c.state() {
            AppState::Sharing { details, .. } => {
                assert_eq!(details.remote.server, ServerView::Online);
                assert_eq!(details.remote.updated_at_unix, Some(1_700_000_000));
                assert_eq!(details.remote.earnings.unwrap().pending_sol, 0.25);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_servers_are_asked_again_only_after_the_interval() {
        let (c, node, _d) = sharing_core("remote-interval");
        let t0 = Instant::now();
        assert!(c.refresh_remote_at(t0, 1, false));
        assert!(!c.refresh_remote_at(t0 + Duration::from_secs(299), 2, false));
        assert!(c.refresh_remote_at(t0 + Duration::from_secs(300), 3, false));
        assert_eq!(node.accounts.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_failed_ask_keeps_the_last_answer_and_is_retried_after_a_minute() {
        use crate::account::ServerView;
        let (c, node, _d) = sharing_core("remote-fail");
        let t0 = Instant::now();
        assert!(c.refresh_remote_at(t0, 1, false));
        *node.account_result.lock().unwrap() = Err("could not run provider-node".into());

        let t1 = t0 + Duration::from_secs(300);
        assert!(c.refresh_remote_at(t1, 2, false));
        assert_eq!(
            server_of(&c.state()),
            ServerView::Online,
            "the old answer stays"
        );
        assert!(!c.refresh_remote_at(t1 + Duration::from_secs(59), 3, false));
        assert!(c.refresh_remote_at(t1 + Duration::from_secs(60), 4, false));
    }

    #[test]
    fn servers_that_could_not_be_reached_are_asked_again_after_a_minute_not_five() {
        use crate::account::ServerView;
        let (c, node, _d) = sharing_core("remote-unreachable");
        *node.account_result.lock().unwrap() =
            Ok(crate::account::parse_account(r#"{"reachable":false}"#).unwrap());
        let t0 = Instant::now();
        assert!(c.refresh_remote_at(t0, 1, false));
        assert_eq!(server_of(&c.state()), ServerView::Unreachable);
        assert!(!c.refresh_remote_at(t0 + Duration::from_secs(59), 2, false));
        assert!(c.refresh_remote_at(t0 + Duration::from_secs(60), 3, false));
    }

    #[test]
    fn refresh_can_be_pressed_early_but_not_in_quick_succession() {
        let (c, _node, _d) = sharing_core("remote-force");
        let t0 = Instant::now();
        assert!(c.refresh_remote_at(t0, 1, false));
        assert!(
            !c.refresh_remote_at(t0 + Duration::from_secs(5), 2, true),
            "too soon"
        );
        assert!(
            c.refresh_remote_at(t0 + Duration::from_secs(25), 3, true),
            "well before 5 min"
        );
    }

    #[test]
    fn sharing_that_begins_again_asks_at_once_instead_of_showing_hours_old_numbers() {
        let (c, node, _d) = sharing_core("remote-resume");
        let t0 = Instant::now();
        assert!(c.refresh_remote_at(t0, 1, false));

        *node.facts.lock().unwrap() = Ok(paired_facts(false, false)); // paused
        c.tick();
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true)); // resumed
        c.tick();
        assert!(
            c.refresh_remote_at(t0 + Duration::from_secs(10), 2, false),
            "ten seconds is far inside the interval, but this is a new stretch of sharing"
        );
    }

    #[test]
    fn the_servers_are_never_asked_without_consent() {
        let (c, node, _d) = core("remote-noconsent");
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        c.tick();
        assert!(!c.refresh_remote_at(Instant::now(), 1, true));
        assert_eq!(node.accounts.load(Ordering::SeqCst), 0);
    }

    /// Consent is checked on its own, not only through "is it sharing": withdrawn (or outdated)
    /// after sharing was seen, the servers are still not asked.
    #[test]
    fn the_servers_are_not_asked_once_consent_is_no_longer_current() {
        let (c, node, _d) = sharing_core("remote-consent-withdrawn");
        c.lock().settings.consent = None;
        assert!(!c.refresh_remote_at(Instant::now(), 1, false));
        assert!(!c.refresh_remote_at(Instant::now(), 1, true));
        assert_eq!(node.accounts.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_new_pairing_forgets_what_was_fetched_about_the_old_computer() {
        use crate::account::ServerView;
        let (c, node, _d) = sharing_core("remote-repair");
        assert!(c.refresh_remote_at(Instant::now(), 1, false));
        assert_eq!(server_of(&c.state()), ServerView::Online);

        let (id, _rx) = c.begin_pairing().unwrap().unwrap();
        c.handle_pair_event(
            id,
            PairEvent::Approved {
                node_id: "n".into(),
            },
        );
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        assert_eq!(server_of(&c.state()), ServerView::Checking);
    }

    #[test]
    fn checking_the_connection_returns_the_findings_and_needs_consent() {
        use crate::diagnosis::{Finding, Level};
        let (c, node, _d) = consented("diagnose");
        *node.diagnosis_result.lock().unwrap() = Ok(Diagnosis {
            findings: vec![Finding {
                level: Level::Problem,
                text: "x".into(),
            }],
        });
        assert_eq!(c.diagnose().unwrap().findings.len(), 1);

        let (c, _node, _d) = core("diagnose-noconsent");
        assert!(c.diagnose().is_err());
    }

    #[test]
    fn support_details_go_into_the_apps_folder_and_only_the_newest_few_are_kept() {
        let (c, _node, d) = consented("support");
        let dir = d.0.join("support");
        std::fs::create_dir_all(&dir).unwrap();
        for n in 1..=7u64 {
            std::fs::write(dir.join(format!("{SUPPORT_PREFIX}{:010}.json", n)), "{}").unwrap();
        }
        std::fs::write(dir.join("notes.txt"), "mine").unwrap();

        let file = c.save_support_details().unwrap();
        assert!(file.starts_with(&dir) && file.is_file());

        let mut names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert!(
            names.contains(&"notes.txt".to_string()),
            "other files are left alone"
        );
        let kept: Vec<_> = names
            .iter()
            .filter(|n| n.starts_with(SUPPORT_PREFIX))
            .collect();
        assert_eq!(kept.len(), SUPPORT_FILES_KEPT);
        assert!(kept.contains(&&file.file_name().unwrap().to_string_lossy().into_owned()));
        assert!(
            !kept.iter().any(|n| n.contains("0000000001")),
            "the oldest went"
        );
    }

    #[test]
    fn a_support_file_that_could_not_be_made_says_so_and_deletes_nothing() {
        let (c, node, d) = consented("support-fail");
        let dir = d.0.join("support");
        std::fs::create_dir_all(&dir).unwrap();
        for n in 1..=6u64 {
            std::fs::write(dir.join(format!("{SUPPORT_PREFIX}{:010}.json", n)), "{}").unwrap();
        }
        *node.bundle_result.lock().unwrap() = Err("The support file could not be made.".into());
        assert!(c.save_support_details().is_err());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 6);
    }

    #[test]
    fn support_details_need_consent() {
        let (c, node, _d) = core("support-noconsent");
        assert!(c.save_support_details().is_err());
        assert_eq!(node.bundles.load(Ordering::SeqCst), 0);
    }

    // ── restart ────────────────────────────────────────────────────────────────

    /// A core whose node the app started itself and which is now running.
    fn running_core(label: &str) -> (Core, std::sync::Arc<FakeNode>, TempDir) {
        let (c, node, d) = consented(label);
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        c.set_sharing(true).unwrap(); // the app starts it
        *node.facts.lock().unwrap() = Ok(paired_facts(true, false)); // and it is connecting
        node.events.lock().unwrap().clear();
        (c, node, d)
    }

    #[test]
    fn restarting_stops_the_node_and_starts_it_again_in_that_order() {
        let (c, node, d) = running_core("restart");
        c.restart_node().unwrap();
        assert_eq!(
            *node.events.lock().unwrap(),
            vec!["stop", "start-begin", "start-end"]
        );
        assert!(settings::load(&d.0).sharing_wanted);
    }

    /// A node started elsewhere belongs to its owner: the app stops it only after the person
    /// confirmed (`stop_outside_node`), never as a side effect of Restart.
    #[test]
    fn a_node_started_outside_the_app_is_not_restarted() {
        let (c, node, _d) = consented("restart-outside");
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true));
        let err = c.restart_node().unwrap_err();
        assert!(err.contains("started outside this app"), "{err}");
        assert!(
            node.events.lock().unwrap().is_empty(),
            "nothing was stopped or started"
        );
    }

    #[test]
    fn restarting_needs_consent_and_a_connected_account() {
        let (c, node, _d) = core("restart-noconsent");
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        assert!(c.restart_node().is_err());

        let (c, node, _d) = consented("restart-noconfig");
        *node.facts.lock().unwrap() = Ok(NodeFacts::default());
        assert!(c.restart_node().unwrap_err().contains("not connected"));
        assert!(node.events.lock().unwrap().is_empty());
    }

    #[test]
    fn a_restart_is_a_wish_to_share_so_it_ends_a_pending_pause() {
        let (c, node, d) = running_core("restart-after-pause");
        c.set_sharing(false).unwrap();
        assert!(settings::load(&d.0).pause_pending);
        *node.facts.lock().unwrap() = Ok(paired_facts(true, false));
        c.restart_node().unwrap();
        let s = settings::load(&d.0);
        assert!(s.sharing_wanted && !s.pause_pending);
    }

    #[test]
    fn a_restart_whose_start_fails_shows_the_problem_and_keeps_the_wish() {
        let (c, node, d) = running_core("restart-fails");
        *node.start_result.lock().unwrap() = Err("could not start".into());
        assert!(c.restart_node().is_err());
        *node.facts.lock().unwrap() = Ok(paired_facts(false, false));
        assert_eq!(
            c.state(),
            AppState::Problem {
                reason: "could not start".into()
            }
        );
        assert!(
            settings::load(&d.0).sharing_wanted,
            "the supervisor will try again"
        );
    }

    /// The stop and the start are one hold: a Pause arriving in between waits for the start and
    /// then stops the node, so it is never left running after the person paused.
    #[test]
    fn a_pause_during_a_restart_waits_and_then_stops_the_node() {
        let (c, node, d) = running_core("restart-pause");
        *node.start_delay.lock().unwrap() = Duration::from_millis(400);
        std::thread::scope(|s| {
            let restart = s.spawn(|| c.restart_node().unwrap());
            std::thread::sleep(Duration::from_millis(150));
            c.set_sharing(false).unwrap();
            restart.join().unwrap();
        });
        assert_eq!(
            *node.events.lock().unwrap(),
            vec!["stop", "start-begin", "start-end", "stop"]
        );
        assert!(!settings::load(&d.0).sharing_wanted);
    }

    // ── disconnect ─────────────────────────────────────────────────────────────

    #[test]
    fn disconnecting_turns_the_wish_off_before_the_node_is_touched_and_reports_the_kept_file() {
        let (c, node, d) = running_core("disconnect");
        *node.watch_dir.lock().unwrap() = Some(d.0.clone());

        let done = c.disconnect().unwrap();
        assert_eq!(
            done.archived_config.as_deref(),
            Some("C:/p/provider.toml.disconnected-1")
        );
        assert_eq!(
            *node.seen_during_unpair.lock().unwrap(),
            Some((false, true)),
            "while the node was being stopped the supervisor must already see 'not wanted'"
        );
        let s = settings::load(&d.0);
        assert!(
            !s.sharing_wanted && !s.pause_pending,
            "settled once it is done"
        );
    }

    #[test]
    fn a_failed_disconnect_changes_nothing_the_wish_goes_back() {
        let (c, node, d) = running_core("disconnect-fails");
        assert!(settings::load(&d.0).sharing_wanted);
        *node.unpair_result.lock().unwrap() = Err("The node did not stop in time.".into());

        assert_eq!(
            c.disconnect().unwrap_err(),
            "The node did not stop in time."
        );
        let s = settings::load(&d.0);
        assert!(s.sharing_wanted, "still sharing as before");
        assert!(!s.pause_pending);
    }

    #[test]
    fn disconnecting_needs_consent() {
        let (c, node, _d) = core("disconnect-noconsent");
        assert!(c.disconnect().is_err());
        assert_eq!(node.unpairs.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn what_was_fetched_about_the_account_left_behind_is_forgotten() {
        use crate::account::ServerView;
        let (c, node, _d) = sharing_core("disconnect-forgets");
        assert!(c.refresh_remote_at(Instant::now(), 1, false));
        assert_eq!(server_of(&c.state()), ServerView::Online);

        c.disconnect().unwrap();
        *node.facts.lock().unwrap() = Ok(paired_facts(true, true)); // connected to the next account
        assert_eq!(server_of(&c.state()), ServerView::Checking);
    }

    #[test]
    fn a_disconnected_computer_is_not_started_again_by_the_supervisor() {
        let (c, node, _d) = running_core("disconnect-stays-off");
        c.disconnect().unwrap();
        *node.facts.lock().unwrap() = Ok(NodeFacts::default()); // no settings file any more
        let starts = node.starts.load(Ordering::SeqCst);
        for _ in 0..3 {
            c.supervise_at(Instant::now() + Duration::from_secs(60));
        }
        assert_eq!(node.starts.load(Ordering::SeqCst), starts);
        assert_eq!(c.state(), AppState::NeedsPairing);
    }

    // ── settings and the update notice ────────────────────────────────────────

    #[test]
    fn the_settings_can_be_read_with_consent_only() {
        let (c, _node, _d) = consented("settings");
        assert_eq!(c.node_settings().unwrap().max_connections, 500);
        let (c, _node, _d) = core("settings-noconsent");
        assert!(c.node_settings().is_err());
    }

    #[test]
    fn a_newer_installer_makes_a_notice_and_an_equal_one_does_not() {
        let (c, node, _d) = consented("update");
        *node.latest_result.lock().unwrap() = Ok("0.1.3".into());
        assert!(
            c.refresh_update_at(Instant::now(), "0.1.2"),
            "the notice changed"
        );
        let n = c.update_notice().unwrap();
        assert_eq!((n.latest.as_str(), n.current.as_str()), ("0.1.3", "0.1.2"));

        let (c, node, _d) = consented("update-current");
        *node.latest_result.lock().unwrap() = Ok("0.1.2".into());
        assert!(!c.refresh_update_at(Instant::now(), "0.1.2"));
        assert_eq!(c.update_notice(), None);
        *node.latest_result.lock().unwrap() = Ok("not a version".into());
        let t = Instant::now() + UPDATE_INTERVAL;
        assert!(!c.refresh_update_at(t, "0.1.2"));
        assert_eq!(c.update_notice(), None, "garbage is never an update");
    }

    #[test]
    fn the_newest_version_is_looked_up_only_every_few_hours() {
        let (c, node, _d) = consented("update-interval");
        let t0 = Instant::now();
        c.refresh_update_at(t0, "0.1.2");
        c.refresh_update_at(t0 + UPDATE_INTERVAL - Duration::from_secs(1), "0.1.2");
        assert_eq!(node.latest_calls.load(Ordering::SeqCst), 1);
        c.refresh_update_at(t0 + UPDATE_INTERVAL, "0.1.2");
        assert_eq!(node.latest_calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_failed_lookup_keeps_the_notice_and_is_retried_in_half_an_hour() {
        let (c, node, _d) = consented("update-fail");
        *node.latest_result.lock().unwrap() = Ok("0.1.3".into());
        let t0 = Instant::now();
        c.refresh_update_at(t0, "0.1.2");

        *node.latest_result.lock().unwrap() = Err("no network".into());
        let t1 = t0 + UPDATE_INTERVAL;
        assert!(!c.refresh_update_at(t1, "0.1.2"));
        assert!(c.update_notice().is_some(), "what was known stays");

        c.refresh_update_at(t1 + UPDATE_RETRY - Duration::from_secs(1), "0.1.2");
        assert_eq!(node.latest_calls.load(Ordering::SeqCst), 2, "not yet");
        c.refresh_update_at(t1 + UPDATE_RETRY, "0.1.2");
        assert_eq!(
            node.latest_calls.load(Ordering::SeqCst),
            3,
            "after half an hour"
        );
    }

    #[test]
    fn nothing_is_looked_up_before_consent() {
        let (c, node, _d) = core("update-noconsent");
        assert!(!c.refresh_update_at(Instant::now(), "0.1.2"));
        assert_eq!(node.latest_calls.load(Ordering::SeqCst), 0);
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
