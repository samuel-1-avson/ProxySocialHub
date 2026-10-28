use crate::{paths, process_util};
use anyhow::{Context, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

const SERVICE_NAME: &str = "proxyhubb-provider";

/// Windows sign-in entry name; also what Task Manager → Startup apps displays.
#[cfg(windows)]
const AUTOSTART_NAME: &str = "ProxyHubb Provider Node";
#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const STARTUP_APPROVED_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
/// Windows only honours Run-key commands up to MAX_PATH characters.
#[cfg(any(windows, test))]
const RUN_COMMAND_MAX_CHARS: usize = 260;

#[derive(Debug, Serialize)]
pub struct ServiceStatus {
    pub service_name: String,
    pub installed: bool,
    pub running: bool,
    pub pid: Option<u32>,
    pub config_path: String,
    pub unit_path: Option<String>,
    pub message: String,
}

pub fn install(config: Option<PathBuf>) -> Result<()> {
    let config_path = config.unwrap_or_else(paths::config_file);
    let exe = current_exe()?;

    // A per-user sign-in entry rather than an SCM service: provider-node is a console
    // program that never talks to the Service Control Manager, so `sc.exe create` +
    // `sc start` would be killed with error 1053. This also needs no administrator
    // rights, and the user can turn it off under Task Manager → Startup apps.
    #[cfg(windows)]
    {
        let command = autostart_command(&exe, &config_path);
        run_entry::write(RUN_KEY, STARTUP_APPROVED_KEY, AUTOSTART_NAME, &command)?;
        println!("Installed Windows startup entry: {AUTOSTART_NAME}");
        println!("provider-node will start in the background each time you sign in.");
        if legacy_service_installed() {
            println!(
                "Note: an older {SERVICE_NAME} Windows service is registered and does not work. \
                 Remove it from an administrator prompt: sc.exe delete {SERVICE_NAME}"
            );
        }
        println!("Start it now with: provider-node service start");
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let plist_path = launch_agent_path();
        if let Some(parent) = plist_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&plist_path, macos_plist(&exe, &config_path))?;
        println!("Installed LaunchAgent: {}", plist_path.display());
        println!("Start with: provider-node service start");
        Ok(())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let unit_path = systemd_unit_path();
        if let Some(parent) = unit_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&unit_path, systemd_unit(&exe, &config_path))?;
        let _ = Command::new("systemctl")
            .args(["--user", "daemon-reload"])
            .status();
        let _ = Command::new("systemctl")
            .args(["--user", "enable", SERVICE_NAME])
            .status();
        println!("Installed systemd user service: {}", unit_path.display());
        println!("Start with: provider-node service start");
        Ok(())
    }

    #[cfg(not(any(windows, target_os = "macos", all(unix, not(target_os = "macos")))))]
    {
        anyhow::bail!("service install is not supported on this OS");
    }
}

pub async fn uninstall() -> Result<()> {
    #[cfg(windows)]
    {
        let _ = stop().await;
        run_entry::remove(RUN_KEY, AUTOSTART_NAME);
        println!("Removed Windows startup entry: {AUTOSTART_NAME}");
        if legacy_service_installed() {
            let removed = Command::new("sc.exe")
                .args(["delete", SERVICE_NAME])
                .output()
                .map(|out| out.status.success())
                .unwrap_or(false);
            if removed {
                println!("Removed legacy Windows service: {SERVICE_NAME}");
            } else {
                println!(
                    "A legacy {SERVICE_NAME} Windows service is still registered. \
                     Remove it from an administrator prompt: sc.exe delete {SERVICE_NAME}"
                );
            }
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let _ = stop().await;
        let plist_path = launch_agent_path();
        let _ = std::fs::remove_file(&plist_path);
        println!("Removed LaunchAgent: {}", plist_path.display());
        Ok(())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = stop().await;
        let unit_path = systemd_unit_path();
        let _ = Command::new("systemctl")
            .args(["--user", "disable", SERVICE_NAME])
            .status();
        let _ = std::fs::remove_file(&unit_path);
        let _ = Command::new("systemctl")
            .args(["--user", "daemon-reload"])
            .status();
        println!("Removed systemd user service: {}", unit_path.display());
        Ok(())
    }

    #[cfg(not(any(windows, target_os = "macos", all(unix, not(target_os = "macos")))))]
    {
        anyhow::bail!("service uninstall is not supported on this OS");
    }
}

/// `config` only matters on Windows, where the daemon is launched directly; the
/// macOS/Linux units already carry the config path they were installed with.
#[cfg_attr(not(windows), allow(unused_variables))]
pub async fn start(config: Option<PathBuf>) -> Result<()> {
    #[cfg(windows)]
    {
        let config_path = config.unwrap_or_else(paths::config_file);
        let result = crate::daemon_ctrl::ensure_started(&config_path).await?;
        println!("{}", crate::daemon_ctrl::describe(result));
        Ok(())
    }

    #[cfg(not(windows))]
    {
        #[cfg(target_os = "macos")]
        let status = Command::new("launchctl")
            .args(["load", "-w", &launch_agent_path().to_string_lossy()])
            .status();

        #[cfg(all(unix, not(target_os = "macos")))]
        let status = Command::new("systemctl")
            .args(["--user", "start", SERVICE_NAME])
            .status();

        finish_service_command(status, "start")
    }
}

pub async fn stop() -> Result<()> {
    #[cfg(windows)]
    {
        let stopped = crate::daemon_ctrl::stop_if_running().await?;
        println!(
            "{}",
            if stopped {
                "Stopped the provider-node daemon"
            } else {
                "provider-node daemon was not running"
            }
        );
        Ok(())
    }

    #[cfg(not(windows))]
    {
        #[cfg(target_os = "macos")]
        let status = Command::new("launchctl")
            .args(["unload", "-w", &launch_agent_path().to_string_lossy()])
            .status();

        #[cfg(all(unix, not(target_os = "macos")))]
        let status = Command::new("systemctl")
            .args(["--user", "stop", SERVICE_NAME])
            .status();

        finish_service_command(status, "stop")
    }
}

pub fn status(config: Option<PathBuf>) -> ServiceStatus {
    let pid = process_util::read_pid_file();
    let running = pid
        .map(process_util::provider_process_alive)
        .unwrap_or(false);
    let unit_path = platform_unit_path();
    let installed = unit_path
        .as_ref()
        .map(|path| Path::new(path).exists())
        .unwrap_or(false)
        || autostart_installed();
    let config_path = config.unwrap_or_else(paths::config_file);
    ServiceStatus {
        service_name: SERVICE_NAME.to_string(),
        installed,
        running,
        pid: pid.filter(|_| running),
        config_path: config_path.display().to_string(),
        unit_path,
        message: if running {
            "provider-node service appears to be running".to_string()
        } else if installed {
            "service installed but provider-node is not currently running".to_string()
        } else {
            "service is not installed".to_string()
        },
    }
}

pub fn print_status(status: &ServiceStatus) {
    println!("--- Provider Node Service ---");
    println!("Name:      {}", status.service_name);
    println!("Installed: {}", status.installed);
    println!("Running:   {}", status.running);
    if let Some(pid) = status.pid {
        println!("PID:       {pid}");
    }
    println!("Config:    {}", status.config_path);
    if let Some(path) = &status.unit_path {
        println!("Unit:      {path}");
    }
    println!("Status:    {}", status.message);
}

fn current_exe() -> Result<PathBuf> {
    std::env::current_exe().context("failed to resolve provider-node executable")
}

#[cfg(not(windows))]
fn finish_service_command(
    status: std::io::Result<std::process::ExitStatus>,
    action: &str,
) -> Result<()> {
    let status = status.with_context(|| format!("failed to run service {action} command"))?;
    if status.success() {
        println!("Service {action} requested for {SERVICE_NAME}");
        Ok(())
    } else {
        anyhow::bail!("service {action} command failed with {status}")
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn systemd_unit_path() -> PathBuf {
    paths::home_dir()
        .join(".config")
        .join("systemd")
        .join("user")
        .join(format!("{SERVICE_NAME}.service"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn systemd_unit(exe: &Path, config: &Path) -> String {
    format!(
        "[Unit]\nDescription=ProxyHubb Provider Node\nAfter=network-online.target\n\n[Service]\nType=simple\nExecStart={} start --config {}\nRestart=always\nRestartSec=10\n\n[Install]\nWantedBy=default.target\n",
        exe.display(),
        config.display()
    )
}

#[cfg(target_os = "macos")]
fn launch_agent_path() -> PathBuf {
    paths::home_dir()
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{SERVICE_NAME}.plist"))
}

#[cfg(target_os = "macos")]
fn macos_plist(exe: &Path, config: &Path) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{SERVICE_NAME}</string>
  <key>ProgramArguments</key><array>
    <string>{}</string><string>start</string><string>--config</string><string>{}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
"#,
        exe.display(),
        config.display()
    )
}

fn platform_unit_path() -> Option<String> {
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Some(systemd_unit_path().display().to_string())
    }
    #[cfg(target_os = "macos")]
    {
        Some(launch_agent_path().display().to_string())
    }
    #[cfg(windows)]
    {
        Some(format!(r"HKCU\{RUN_KEY}\{AUTOSTART_NAME}"))
    }
    #[cfg(not(any(windows, target_os = "macos", all(unix, not(target_os = "macos")))))]
    {
        None
    }
}

/// The command line the sign-in entry runs: start the daemon in the background and exit.
#[cfg(any(windows, test))]
fn autostart_command(exe: &Path, config: &Path) -> String {
    format!(
        "\"{}\" start --background --config \"{}\"",
        exe.display(),
        config.display()
    )
}

#[cfg(windows)]
fn autostart_installed() -> bool {
    run_entry::read(RUN_KEY, AUTOSTART_NAME).is_some()
}

/// Per-user sign-in entry in the registry. Key paths are parameters so tests can
/// exercise the real code against a scratch key instead of the live Run key.
#[cfg(windows)]
mod run_entry {
    use super::{Context, Result, RUN_COMMAND_MAX_CHARS};
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::RegKey;

    pub fn write(run_key: &str, approved_key: &str, name: &str, command: &str) -> Result<()> {
        let len = command.chars().count();
        if len > RUN_COMMAND_MAX_CHARS {
            anyhow::bail!(
                "startup command is {len} characters; Windows allows at most \
                 {RUN_COMMAND_MAX_CHARS}. Move provider-node.exe and provider.toml to \
                 shorter paths and retry"
            );
        }
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (run, _) = hkcu
            .create_subkey(run_key)
            .context("failed to open the Windows startup registry key")?;
        run.set_value(name, &command)
            .context("failed to write the Windows startup entry")?;
        // Re-enable the entry if it was switched off earlier in Task Manager.
        if let Ok(approved) = hkcu.open_subkey_with_flags(approved_key, KEY_SET_VALUE) {
            let _ = approved.delete_value(name);
        }
        Ok(())
    }

    pub fn remove(run_key: &str, name: &str) {
        if let Ok(run) =
            RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(run_key, KEY_SET_VALUE)
        {
            // Not-found just means the entry was never installed (or already removed).
            let _ = run.delete_value(name);
        }
    }

    pub fn read(run_key: &str, name: &str) -> Option<String> {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(run_key, KEY_READ)
            .and_then(|run| run.get_value::<String, _>(name))
            .ok()
    }
}

#[cfg(not(windows))]
fn autostart_installed() -> bool {
    false
}

/// The `sc.exe create` service older builds registered, which could never start
/// (see `install`).
#[cfg(windows)]
fn legacy_service_installed() -> bool {
    Command::new("sc.exe")
        .args(["query", SERVICE_NAME])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autostart_command_quotes_paths_with_spaces() {
        let cmd = autostart_command(
            Path::new(r"C:\Program Files\ProxyHubb\provider-node.exe"),
            Path::new(r"C:\Users\Jane Doe\AppData\Roaming\proxyhubb\provider.toml"),
        );
        assert_eq!(
            cmd,
            r#""C:\Program Files\ProxyHubb\provider-node.exe" start --background --config "C:\Users\Jane Doe\AppData\Roaming\proxyhubb\provider.toml""#
        );
    }

    /// Scratch registry tree that is removed when dropped, even if an assertion fails.
    #[cfg(windows)]
    struct ScratchKeys(String);

    #[cfg(windows)]
    impl ScratchKeys {
        fn new(label: &str) -> Self {
            let root = format!(
                r"Software\ProxyHubbProviderNodeTest-{label}-{}",
                std::process::id()
            );
            let scratch = Self(root);
            scratch.delete();
            scratch
        }
        fn run_key(&self) -> String {
            format!(r"{}\Run", self.0)
        }
        fn approved_key(&self) -> String {
            format!(r"{}\StartupApproved", self.0)
        }
        fn delete(&self) {
            use winreg::enums::HKEY_CURRENT_USER;
            let _ = winreg::RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(&self.0);
        }
    }

    #[cfg(windows)]
    impl Drop for ScratchKeys {
        fn drop(&mut self) {
            self.delete();
        }
    }

    #[cfg(windows)]
    #[test]
    fn run_entry_writes_reads_and_removes_a_value() {
        use winreg::enums::{HKEY_CURRENT_USER, REG_BINARY};
        use winreg::{RegKey, RegValue};

        let keys = ScratchKeys::new("roundtrip");
        // A "disabled" marker left behind by switching the app off in Task Manager.
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (approved, _) = hkcu.create_subkey(keys.approved_key()).unwrap();
        approved
            .set_raw_value(
                AUTOSTART_NAME,
                &RegValue {
                    bytes: vec![3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].into(),
                    vtype: REG_BINARY,
                },
            )
            .unwrap();

        let cmd = autostart_command(
            Path::new(r"C:\Program Files\ProxyHubb\provider-node.exe"),
            Path::new(r"C:\Users\Jane Doe\provider.toml"),
        );
        assert_eq!(run_entry::read(&keys.run_key(), AUTOSTART_NAME), None);
        run_entry::write(&keys.run_key(), &keys.approved_key(), AUTOSTART_NAME, &cmd).unwrap();
        assert_eq!(
            run_entry::read(&keys.run_key(), AUTOSTART_NAME).as_deref(),
            Some(cmd.as_str())
        );
        assert!(
            approved.get_raw_value(AUTOSTART_NAME).is_err(),
            "install should clear an earlier Task Manager 'disabled' marker"
        );

        run_entry::remove(&keys.run_key(), AUTOSTART_NAME);
        assert_eq!(run_entry::read(&keys.run_key(), AUTOSTART_NAME), None);
        // Removing again is a no-op, not an error.
        run_entry::remove(&keys.run_key(), AUTOSTART_NAME);
    }

    #[cfg(windows)]
    #[test]
    fn run_entry_refuses_a_command_longer_than_windows_allows() {
        let keys = ScratchKeys::new("toolong");
        let cmd = "x".repeat(RUN_COMMAND_MAX_CHARS + 1);
        let err = run_entry::write(&keys.run_key(), &keys.approved_key(), AUTOSTART_NAME, &cmd)
            .unwrap_err();
        assert!(err.to_string().contains("261 characters"), "{err}");
        assert_eq!(run_entry::read(&keys.run_key(), AUTOSTART_NAME), None);
    }

    #[test]
    fn typical_autostart_command_fits_the_run_key_limit() {
        let cmd = autostart_command(
            Path::new(r"C:\Users\Jane Doe\AppData\Local\Programs\ProxyHubb\provider-node.exe"),
            Path::new(r"C:\Users\Jane Doe\AppData\Roaming\proxyhubb\provider.toml"),
        );
        assert!(cmd.chars().count() <= RUN_COMMAND_MAX_CHARS, "{cmd}");
    }
}
