use crate::{paths, process_util};
use anyhow::{Context, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

const SERVICE_NAME: &str = "proxyhubb-provider";

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

    #[cfg(windows)]
    {
        let bin_path = format!("{} start --config {}", exe.display(), config_path.display());
        let status = Command::new("sc.exe")
            .args(["query", SERVICE_NAME])
            .status()
            .context("failed to query Windows service")?;
        if !status.success() {
            let create_status = Command::new("sc.exe")
                .args([
                    "create",
                    SERVICE_NAME,
                    "binPath=",
                    &bin_path,
                    "start=",
                    "auto",
                    "DisplayName=",
                    "ProxyHubb Provider Node",
                ])
                .status()
                .context("failed to create Windows service")?;
            if !create_status.success() {
                anyhow::bail!("sc.exe create failed for {SERVICE_NAME}");
            }
        }
        println!("Installed Windows service: {SERVICE_NAME}");
        println!("Start with: provider-node service start");
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

pub fn uninstall() -> Result<()> {
    #[cfg(windows)]
    {
        let _ = stop();
        let status = Command::new("sc.exe")
            .args(["delete", SERVICE_NAME])
            .status()
            .context("failed to delete Windows service")?;
        if !status.success() {
            anyhow::bail!("sc.exe delete failed for {SERVICE_NAME}");
        }
        println!("Uninstalled Windows service: {SERVICE_NAME}");
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let _ = stop();
        let plist_path = launch_agent_path();
        let _ = std::fs::remove_file(&plist_path);
        println!("Removed LaunchAgent: {}", plist_path.display());
        Ok(())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = stop();
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

pub fn start() -> Result<()> {
    #[cfg(windows)]
    let status = Command::new("sc.exe")
        .args(["start", SERVICE_NAME])
        .status();

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

pub fn stop() -> Result<()> {
    #[cfg(windows)]
    let status = Command::new("sc.exe").args(["stop", SERVICE_NAME]).status();

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

pub fn status(config: Option<PathBuf>) -> ServiceStatus {
    let pid = process_util::read_pid_file();
    let running = pid.map(process_util::process_alive).unwrap_or(false);
    let unit_path = platform_unit_path();
    let installed = unit_path
        .as_ref()
        .map(|path| Path::new(path).exists())
        .unwrap_or(false)
        || windows_service_installed();
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
        None
    }
    #[cfg(not(any(windows, target_os = "macos", all(unix, not(target_os = "macos")))))]
    {
        None
    }
}

fn windows_service_installed() -> bool {
    #[cfg(windows)]
    {
        Command::new("sc.exe")
            .args(["query", SERVICE_NAME])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}
