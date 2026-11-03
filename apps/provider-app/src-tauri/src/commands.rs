//! The only surface the webview can call: a handful of typed commands, plus the background
//! threads that keep the node running and tell the window when something changed.
//!
//! Rules this file keeps (tests below pin the ones that can be tested):
//! - the webview never supplies a URL or an argument that reaches a process;
//! - every command that touches the node runs off the UI thread;
//! - the window's capability file grants nothing beyond `core:default`.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, Manager, State, Wry};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_opener::OpenerExt as _;

use crate::app_update::UpdateNotice;
use crate::diagnosis::Diagnosis;
use crate::disconnect::DisconnectResult;
use crate::engine::AppCore;
use crate::node::{is_allowed_link, locate_sidecar, Sidecar};
use crate::node_settings::NodeSettings;
use crate::state::{tooltip_for, tray_view_for, AppState, TrayView};

pub type Core = AppCore<Sidecar>;

/// The tray menu's items, kept so the menu can follow the state: only the action that can run
/// now is enabled, and a status line says what the app is doing.
pub struct TrayItems {
    pub status: MenuItem<Wry>,
    pub pause: MenuItem<Wry>,
    pub resume: MenuItem<Wry>,
    pub quit: MenuItem<Wry>,
    /// What was last applied, so a menu that did not change is not touched every few seconds.
    applied: Mutex<Option<TrayView>>,
}

impl TrayItems {
    pub fn new(
        status: MenuItem<Wry>,
        pause: MenuItem<Wry>,
        resume: MenuItem<Wry>,
        quit: MenuItem<Wry>,
    ) -> Self {
        TrayItems {
            status,
            pause,
            resume,
            quit,
            applied: Mutex::new(None),
        }
    }

    fn apply(&self, view: TrayView) {
        let mut applied = self.applied.lock().unwrap_or_else(|e| e.into_inner());
        if applied.as_ref() == Some(&view) {
            return;
        }
        let _ = self.status.set_text(&view.status);
        let _ = self.pause.set_enabled(view.pause_enabled);
        let _ = self.resume.set_enabled(view.resume_enabled);
        let _ = self.quit.set_text(view.quit_label);
        *applied = Some(view);
    }
}

/// The tray icon's id, so its tooltip can follow the state.
pub const TRAY_ID: &str = "main-tray";

/// Events the UI listens for.
pub const STATE_EVENT: &str = "app://state";
pub const PAIRING_ENDED_EVENT: &str = "app://pairing-ended";
/// A newer installer was found (payload: the notice) or none is newer (payload: null).
pub const UPDATE_EVENT: &str = "app://update";

/// Where "Open my dashboard" goes. Fixed: not an argument.
const DASHBOARD_URL: &str = "https://proxyhubb.com/dashboard/provider";
/// Where a disconnected computer's key is revoked ("Paired: <computer>"). Fixed, as above.
const TOKENS_URL: &str = "https://proxyhubb.com/dashboard/provider/tokens";
/// Where the newest installer is. Fixed, as above.
const DOWNLOAD_URL: &str = "https://proxyhubb.com/dashboard/provider/cli#desktop-app";

/// How often the node is checked and the window refreshed.
const SUPERVISE_INTERVAL: Duration = Duration::from_secs(5);

/// How often the refresher looks at whether ProxyHubb's servers are due to be asked. The ask
/// itself is rate-limited by the engine; this only sets how soon after sharing starts it happens.
const REMOTE_CHECK_INTERVAL: Duration = Duration::from_secs(15);

/// Environment variable that pins the folder the app keeps its settings in. Tauri resolves the
/// config folder through the Windows Known Folder API, which ignores `%APPDATA%`, so without
/// this a test run would record consent in a real profile.
pub const APP_DIR_ENV: &str = "PROXYHUB_APP_DIR";

/// Where settings live: `PROXYHUB_APP_DIR` if set and non-empty, otherwise the app's own
/// config directory. The default is only asked for when nothing is pinned, because resolving
/// it can fail (an unusual profile, a redirected environment) and a pinned folder must not
/// depend on it.
fn settings_dir_from(
    pinned: Option<std::ffi::OsString>,
    default: impl FnOnce() -> Result<PathBuf, String>,
) -> Result<PathBuf, String> {
    match pinned.filter(|p| !p.is_empty()) {
        Some(dir) => Ok(PathBuf::from(dir)),
        None => default(),
    }
}

/// Build the core for this install.
pub fn build_core(app: &AppHandle) -> Result<Core, String> {
    let dir = settings_dir_from(std::env::var_os(APP_DIR_ENV), || {
        app.path()
            .app_config_dir()
            .map_err(|e| format!("could not find a place to keep the app's settings: {e}"))
    })?;
    Ok(AppCore::new(Sidecar::new(locate_sidecar()?), dir))
}

pub fn emit_state(app: &AppHandle, core: &Core) {
    publish(app, core.state());
}

/// Show a state everywhere it is shown: the window, the tray tooltip and the tray menu.
fn publish(app: &AppHandle, state: AppState) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(tooltip_for(&state)));
    }
    if let Some(items) = app.try_state::<TrayItems>() {
        items.apply(tray_view_for(&state));
    }
    let _ = app.emit(STATE_EVENT, state);
}

/// Keep the node running if the person wants it, and keep the window fresh. Runs for the life
/// of the app. Each pass looks at the node once and uses that for both jobs.
pub fn spawn_supervisor(app: AppHandle, core: Arc<Core>) {
    thread::spawn(move || loop {
        let state = core.tick();
        publish(&app, state);
        thread::sleep(SUPERVISE_INTERVAL);
    });
}

/// Ask ProxyHubb's servers about this computer when it is due, for the life of the app. A
/// separate thread from the supervisor: an ask waits on the network for up to a minute, and the
/// node must not go unwatched meanwhile.
pub fn spawn_remote_refresher(app: AppHandle, core: Arc<Core>) {
    thread::spawn(move || loop {
        if core.refresh_update() {
            let _ = app.emit(UPDATE_EVENT, core.update_notice());
        }
        if core.refresh_remote(false) {
            emit_state(&app, &core);
        }
        thread::sleep(REMOTE_CHECK_INTERVAL);
    });
}

/// Run blocking work (these spawn processes) off the UI thread.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("background task failed: {e}"))
}

#[tauri::command]
pub async fn app_state(core: State<'_, Arc<Core>>) -> Result<AppState, String> {
    let core = Arc::clone(&core);
    blocking(move || core.state()).await
}

#[tauri::command]
pub async fn accept_consent(app: AppHandle, core: State<'_, Arc<Core>>) -> Result<(), String> {
    let core = Arc::clone(&core);
    blocking(move || {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let result = core.accept_consent(now);
        emit_state(&app, &core);
        result
    })
    .await?
}

#[tauri::command]
pub async fn begin_pairing(app: AppHandle, core: State<'_, Arc<Core>>) -> Result<(), String> {
    let core = Arc::clone(&core);
    blocking(move || {
        if let Some((id, events)) = core.begin_pairing()? {
            let pump_core = Arc::clone(&core);
            thread::spawn(move || {
                for event in events {
                    let ended = pump_core.handle_pair_event(id, event);
                    emit_state(&app, &pump_core);
                    if let Some(ended) = ended {
                        let _ = app.emit(PAIRING_ENDED_EVENT, ended);
                        break;
                    }
                }
            });
        }
        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn cancel_pairing(app: AppHandle, core: State<'_, Arc<Core>>) -> Result<(), String> {
    let core = Arc::clone(&core);
    blocking(move || {
        core.cancel_pairing();
        emit_state(&app, &core);
    })
    .await
}

#[tauri::command]
pub async fn set_sharing(
    app: AppHandle,
    core: State<'_, Arc<Core>>,
    on: bool,
) -> Result<(), String> {
    let core = Arc::clone(&core);
    blocking(move || {
        let result = core.set_sharing(on);
        emit_state(&app, &core);
        result
    })
    .await?
}

/// The Refresh button: ask ProxyHubb's servers now (no more often than every few seconds).
#[tauri::command]
pub async fn refresh_account(app: AppHandle, core: State<'_, Arc<Core>>) -> Result<(), String> {
    let core = Arc::clone(&core);
    blocking(move || {
        if core.refresh_remote(true) {
            emit_state(&app, &core);
        }
    })
    .await
}

/// "Check my connection": the node's checks, in plain words.
#[tauri::command]
pub async fn run_diagnosis(core: State<'_, Arc<Core>>) -> Result<Diagnosis, String> {
    let core = Arc::clone(&core);
    blocking(move || core.diagnose()).await?
}

/// "Save support details": write the support file and show it in its folder. Returns where it
/// is. The window never supplies a path; failing to open the folder does not undo the save.
#[tauri::command]
pub async fn save_support_details(
    app: AppHandle,
    core: State<'_, Arc<Core>>,
) -> Result<String, String> {
    let core = Arc::clone(&core);
    blocking(move || {
        let file = core.save_support_details()?;
        let _ = app.opener().reveal_item_in_dir(&file);
        Ok(file.display().to_string())
    })
    .await?
}

/// Restart a node the app started (not one started elsewhere: that is stopped only after the
/// person confirmed, by `stop_outside_node`).
#[tauri::command]
pub async fn restart_node(app: AppHandle, core: State<'_, Arc<Core>>) -> Result<(), String> {
    let core = Arc::clone(&core);
    blocking(move || {
        let result = core.restart_node();
        emit_state(&app, &core);
        result
    })
    .await?
}

/// Disconnect this computer from its account. The window asks the person to confirm first, and
/// tells them the key still has to be revoked in the dashboard.
#[tauri::command]
pub async fn disconnect_computer(
    app: AppHandle,
    core: State<'_, Arc<Core>>,
) -> Result<DisconnectResult, String> {
    let core = Arc::clone(&core);
    blocking(move || {
        let result = core.disconnect();
        emit_state(&app, &core);
        result
    })
    .await?
}

/// This computer's node settings, for reading. Nothing here can change them.
#[tauri::command]
pub async fn get_node_settings(core: State<'_, Arc<Core>>) -> Result<NodeSettings, String> {
    let core = Arc::clone(&core);
    blocking(move || core.node_settings()).await?
}

/// The notice about a newer installer, if there is one. Cheap: it reads what was last found.
#[tauri::command]
pub fn get_update_notice(core: State<'_, Arc<Core>>) -> Option<UpdateNotice> {
    core.update_notice()
}

#[tauri::command]
pub fn open_tokens_page(app: AppHandle) -> Result<(), String> {
    open_checked(&app, TOKENS_URL)
}

#[tauri::command]
pub fn open_download_page(app: AppHandle) -> Result<(), String> {
    open_checked(&app, DOWNLOAD_URL)
}

/// Stop a node the app did not start. The window asks the person to confirm first; a plain
/// Pause never reaches such a node.
#[tauri::command]
pub async fn stop_outside_node(app: AppHandle, core: State<'_, Arc<Core>>) -> Result<(), String> {
    let core = Arc::clone(&core);
    blocking(move || {
        let result = core.stop_outside_node();
        emit_state(&app, &core);
        result
    })
    .await?
}

/// Open the approval link of the pairing in progress. The link is the one the node produced,
/// not one the page sends, and it must still be a ProxyHubb dashboard address.
#[tauri::command]
pub fn open_pairing_link(app: AppHandle, core: State<'_, Arc<Core>>) -> Result<(), String> {
    let link = core
        .pairing_link()
        .ok_or("There is no pairing in progress.")?;
    open_checked(&app, &link)
}

#[tauri::command]
pub fn open_dashboard(app: AppHandle) -> Result<(), String> {
    open_checked(&app, DASHBOARD_URL)
}

fn open_checked(app: &AppHandle, url: &str) -> Result<(), String> {
    if !is_allowed_link(url) {
        return Err("That link is not a ProxyHubb page, so it was not opened.".to_string());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("could not open your browser: {e}"))
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, on: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    if on {
        launcher.enable().map_err(|e| e.to_string())
    } else {
        launcher.disable().map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn a_pinned_settings_folder_never_consults_the_default() {
        let must_not_run = || -> Result<PathBuf, String> {
            panic!("the default must not be resolved when a folder is pinned")
        };
        assert_eq!(
            settings_dir_from(Some(OsString::from("/scratch/app")), must_not_run),
            Ok(PathBuf::from("/scratch/app"))
        );
    }

    #[test]
    fn an_empty_or_missing_pin_falls_back_to_the_default_and_its_failure_is_reported() {
        let default = || Ok(PathBuf::from("/real/profile/com.proxyhubb.provider"));
        for pin in [None, Some(OsString::new())] {
            assert_eq!(
                settings_dir_from(pin, default),
                Ok(PathBuf::from("/real/profile/com.proxyhubb.provider"))
            );
        }
        assert_eq!(
            settings_dir_from(None, || Err("unknown path".to_string())),
            Err("unknown path".to_string())
        );
    }

    /// The window is granted `core:default` and nothing else: no shell, filesystem or
    /// arbitrary-URL capability. If you need more, change this test on purpose and say why.
    #[test]
    fn the_window_capability_grants_nothing_beyond_core_default() {
        let text = include_str!("../capabilities/default.json");
        let json: serde_json::Value = serde_json::from_str(text).expect("capability file is JSON");
        assert_eq!(json["windows"], serde_json::json!(["main"]));
        assert_eq!(json["permissions"], serde_json::json!(["core:default"]));
        for forbidden in ["shell", "fs:", "http", "opener", "process", "dialog"] {
            assert!(
                !text.contains(&format!("\"{forbidden}")),
                "{forbidden} must not be granted"
            );
        }
    }

    #[test]
    fn the_content_security_policy_is_strict() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json is JSON");
        let csp = conf["app"]["security"]["csp"].as_str().expect("csp is set");
        assert!(csp.contains("default-src 'self'"), "{csp}");
        assert!(!csp.contains("'unsafe-eval'"), "{csp}");
        // Tauri's own IPC channel on Windows is the one remote-looking origin that is needed;
        // anything else reaching out (a CDN, an API) would be a hole.
        let without_ipc = csp.replace("http://ipc.localhost", "");
        assert!(
            !without_ipc.contains("http:")
                && !without_ipc.contains("https:")
                && !without_ipc.contains('*'),
            "{csp}"
        );
        assert_eq!(conf["app"]["withGlobalTauri"], serde_json::json!(false));
    }

    #[test]
    fn the_only_external_binary_is_provider_node() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            conf["bundle"]["externalBin"],
            serde_json::json!(["binaries/provider-node"])
        );
    }
}
