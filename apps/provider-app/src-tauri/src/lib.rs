//! ProxyHubb Provider: a tray app around the bundled `provider-node`.
//! Spike stage (plan step 0.2): window, tray, and one command that runs the sidecar.

use std::path::PathBuf;
use std::process::{Command, Stdio};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

/// The `provider-node` shipped next to this executable. Tauri copies `externalBin`
/// entries there without the target-triple suffix.
fn sidecar_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("the app executable has no parent directory")?;
    let name = if cfg!(windows) {
        "provider-node.exe"
    } else {
        "provider-node"
    };
    let path = dir.join(name);
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!("bundled provider-node not found at {}", path.display()))
    }
}

/// A console program started from a GUI app would flash a console window on Windows.
fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[tauri::command]
fn sidecar_version() -> Result<String, String> {
    let mut cmd = Command::new(sidecar_path()?);
    let out = quiet(cmd.arg("--version").stdin(Stdio::null()))
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("provider-node --version exited with {}", out.status));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sidecar_version])
        .run(tauri::generate_context!())
        .expect("error while running the ProxyHubb Provider app");
}
