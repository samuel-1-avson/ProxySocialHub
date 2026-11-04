//! ProxyHubb Provider: a tray app around the bundled `provider-node`.
//!
//! The window is a thin view; `engine` holds the behaviour, `node` drives the bundled node,
//! and `commands` is the only surface the webview can call.

mod account;
mod app_update;
mod commands;
mod diagnosis;
mod disconnect;
mod engine;
mod node;
mod node_settings;
mod rules;
mod settings;
mod state;

use std::sync::Arc;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use commands::Core;

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Pause or resume from the tray, off the main thread (it starts or stops a process).
fn tray_set_sharing(app: &AppHandle, on: bool) {
    let app = app.clone();
    let core = Arc::clone(&app.state::<Arc<Core>>());
    std::thread::spawn(move || {
        // Without consent this is refused; the window then shows why when it is opened.
        let _ = core.set_sharing(on);
        commands::emit_state(&app, &core);
    });
}

pub fn run() {
    // Started at sign-in: stay in the tray instead of opening a window.
    let start_hidden = std::env::args().any(|a| a == "--hidden");

    tauri::Builder::default()
        // Must be first: a second launch focuses the running app instead of starting another.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let core: Arc<Core> = Arc::new(commands::build_core(app.handle())?);
            app.manage(Arc::clone(&core));

            // The first pass of the supervisor (right after this) enables what can run and writes
            // the status line, so nothing is offered before the state is known.
            let status = MenuItem::with_id(app, "status", "Starting…", false, None::<&str>)?;
            let open =
                MenuItem::with_id(app, "open", "Open ProxyHubb Provider", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Pause sharing", false, None::<&str>)?;
            let resume = MenuItem::with_id(app, "resume", "Resume sharing", false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit (stops sharing)", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &status,
                    &PredefinedMenuItem::separator(app)?,
                    &open,
                    &pause,
                    &resume,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?;
            app.manage(commands::TrayItems::new(status, pause, resume, quit));

            let mut tray = TrayIconBuilder::with_id(commands::TRAY_ID)
                .tooltip("ProxyHubb Provider")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "pause" => tray_set_sharing(app, false),
                    "resume" => tray_set_sharing(app, true),
                    "quit" => {
                        // Quitting stops sharing; the saved wish is kept, so the next launch
                        // resumes.
                        app.state::<Arc<Core>>().shutdown();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            if !start_hidden {
                show_main_window(app.handle());
            }
            commands::spawn_remote_refresher(app.handle().clone(), Arc::clone(&core));
            commands::spawn_supervisor(app.handle().clone(), core);
            Ok(())
        })
        // Closing the window hides it to the tray; sharing continues. Quit is in the tray menu.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_state,
            commands::accept_consent,
            commands::begin_pairing,
            commands::cancel_pairing,
            commands::set_sharing,
            commands::stop_outside_node,
            commands::refresh_account,
            commands::run_diagnosis,
            commands::save_support_details,
            commands::restart_node,
            commands::disconnect_computer,
            commands::get_node_settings,
            commands::draft_rules,
            commands::save_blocked_sites,
            commands::get_update_notice,
            commands::open_tokens_page,
            commands::open_download_page,
            commands::open_pairing_link,
            commands::open_dashboard,
            commands::get_autostart,
            commands::set_autostart,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the ProxyHubb Provider app")
        .run(|app, event| {
            // However the app ends (tray Quit, OS shutdown), do not leave a node running that
            // the person can no longer see or control. Stopping twice is harmless.
            if let RunEvent::Exit = event {
                if let Some(core) = app.try_state::<Arc<Core>>() {
                    core.shutdown();
                }
            }
        });
}
