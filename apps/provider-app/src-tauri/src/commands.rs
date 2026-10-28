//! The only surface the webview can call: a handful of typed commands, plus the background
//! threads that keep the node running and tell the window when something changed.
//!
//! Rules this file keeps (tests below pin the ones that can be tested):
//! - the webview never supplies a URL or an argument that reaches a process;
//! - every command that touches the node runs off the UI thread;
//! - the window's capability file grants nothing beyond `core:default`.

use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_opener::OpenerExt as _;

use crate::engine::AppCore;
use crate::node::{is_allowed_link, locate_sidecar, Sidecar};
use crate::state::{tooltip_for, AppState};

pub type Core = AppCore<Sidecar>;

/// The tray icon's id, so its tooltip can follow the state.
pub const TRAY_ID: &str = "main-tray";

/// Events the UI listens for.
pub const STATE_EVENT: &str = "app://state";
pub const PAIRING_ENDED_EVENT: &str = "app://pairing-ended";

/// Where "Open my dashboard" goes. Fixed: not an argument.
const DASHBOARD_URL: &str = "https://proxyhubb.com/dashboard/provider";

/// How often the node is checked and the window refreshed.
const SUPERVISE_INTERVAL: Duration = Duration::from_secs(5);

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
    let state = core.state();
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(tooltip_for(&state)));
    }
    let _ = app.emit(STATE_EVENT, state);
}

/// Keep the node running if the person wants it, and keep the window fresh. Runs for the life
/// of the app.
pub fn spawn_supervisor(app: AppHandle, core: Arc<Core>) {
    thread::spawn(move || loop {
        core.supervise_once();
        emit_state(&app, &core);
        thread::sleep(SUPERVISE_INTERVAL);
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
