//! Interactive console when `provider-node` is launched with no subcommand
//! (e.g. double-click on Windows). Keeps a real window open so operators
//! can pick dashboard / doctor / status without memorizing flags.
//!
//! The tunnel daemon is started in the background automatically when config
//! exists, so the TUI can run in this same window.

use crate::daemon_ctrl;
use crate::paths;
use std::io::{self, Write};
use std::path::PathBuf;

pub async fn run() -> anyhow::Result<()> {
    let config = paths::config_file();
    if let Some(adopted) = crate::config_adopt::maybe_adopt_downloaded_config(&config) {
        println!(
            "  Imported config from Downloads:\n    {}\n  → {}\n  ({})",
            adopted.from.display(),
            adopted.to.display(),
            adopted.reason
        );
    }
    print_banner(&config);

    if config.is_file() {
        match daemon_ctrl::ensure_running(&config).await {
            Ok(result) => println!("  {}", daemon_ctrl::describe(result)),
            Err(e) => eprintln!("  Daemon auto-start skipped: {e:#}"),
        }
    }

    // Best-effort update notice (never blocks menu on network failure).
    match crate::update::check().await {
        Ok(info) if !info.already_latest => {
            println!(
                "  Update available: v{} → v{}  (menu [7] or: provider-node update)",
                info.current, info.latest
            );
        }
        Ok(_) => {}
        Err(_) => {}
    }

    loop {
        println!();
        println!("  [1] Open live dashboard (daemon stays in background)");
        println!("  [2] Run doctor (pre-flight checks)");
        println!("  [3] Show status");
        println!("  [4] Start/restart daemon in background");
        println!("  [5] Start daemon in this window (foreground / blocks)");
        println!("  [6] Print install paths & hints");
        println!("  [7] Update CLI in place (download latest from Control API)");
        println!("  [h] Help / recommended first-run");
        println!("  [q] Quit");
        print!("\n  Choice> ");
        let _ = io::stdout().flush();

        let mut line = String::new();
        if io::stdin().read_line(&mut line).is_err() {
            break;
        }
        let choice = line.trim().to_ascii_lowercase();
        match choice.as_str() {
            "1" | "d" | "dashboard" => {
                if let Err(_e) = ensure_daemon_or_report(&config).await {
                    wait_enter();
                    print_banner(&config);
                    continue;
                }
                println!("\nStarting dashboard… (q / Ctrl+C returns here; daemon keeps running)\n");
                if let Err(e) = crate::tui::dashboard::run(config.clone(), 1000).await {
                    eprintln!("Dashboard error: {e:#}");
                    wait_enter();
                }
                print_banner(&config);
            }
            "2" | "doctor" => {
                println!();
                match crate::doctor::run(config.clone()).await {
                    Ok(report) => {
                        crate::doctor::print_human(&report);
                        if !report.ok {
                            eprintln!("Doctor reported blocking issues.");
                        }
                    }
                    Err(e) => eprintln!("Doctor error: {e:#}"),
                }
                wait_enter();
                print_banner(&config);
            }
            "3" | "status" => {
                println!();
                match crate::status::collect(config.clone(), None).await {
                    Ok(report) => crate::status::print_human(&report),
                    Err(e) => eprintln!("Status error: {e:#}"),
                }
                wait_enter();
                print_banner(&config);
            }
            "4" | "start" | "bg" | "restart" => {
                println!();
                println!("Restarting daemon in the background…");
                match daemon_ctrl::restart(&config).await {
                    Ok(result) => {
                        println!("{}", daemon_ctrl::describe(result));
                        println!("Logs: {}", paths::log_file().display());
                        println!("Open [1] dashboard in this window anytime.");
                    }
                    Err(e) => eprintln!("Failed to start background daemon: {e:#}"),
                }
                wait_enter();
                print_banner(&config);
            }
            "5" | "fg" | "foreground" => {
                println!("\nStarting provider-node daemon in the foreground…");
                println!("Config: {}", config.display());
                println!("Press Ctrl+C to stop.\n");
                println!("Tip: prefer [4] background + [1] dashboard in one window.\n");
                let exe =
                    std::env::current_exe().unwrap_or_else(|_| PathBuf::from("provider-node"));
                let status = std::process::Command::new(&exe)
                    .arg("start")
                    .arg("--config")
                    .arg(&config)
                    .status();
                match status {
                    Ok(s) if s.success() => {}
                    Ok(s) => eprintln!("Daemon exited with status {s}"),
                    Err(e) => eprintln!("Failed to start daemon: {e}"),
                }
                wait_enter();
                print_banner(&config);
            }
            "6" | "install" | "paths" => {
                println!();
                crate::install::print_paths_and_hints();
                wait_enter();
                print_banner(&config);
            }
            "7" | "update" | "upgrade" => {
                println!();
                match crate::update::run(false, false).await {
                    Ok(()) => {}
                    Err(e) => eprintln!("Update failed: {e:#}"),
                }
                wait_enter();
                print_banner(&config);
            }
            "h" | "help" | "?" => {
                println!();
                println!("First-run checklist:");
                println!("  1. Download provider.toml from Dashboard → My nodes → Connect");
                println!("     Place it at:");
                println!("       {}", config.display());
                println!("  2. Launch this CLI — daemon auto-starts in the background");
                println!("  3. Choose [2] doctor — fix any red checks");
                println!("  4. Choose [1] dashboard — live metrics while the tunnel runs");
                println!();
                println!("Updates:");
                println!("  Choose [7] or run: provider-node update");
                println!("  Replaces this binary in place — no need to delete the old download.");
                println!();
                println!("The tunnel keeps running after you quit the dashboard.");
                println!("Stop it with: provider-node stop");
                wait_enter();
                print_banner(&config);
            }
            "q" | "quit" | "exit" => {
                println!("Goodbye.");
                println!("(Background daemon keeps running if it was started.)");
                break;
            }
            "" => continue,
            other => {
                println!("Unknown choice: {other}");
            }
        }
    }

    Ok(())
}

async fn ensure_daemon_or_report(config: &std::path::Path) -> anyhow::Result<()> {
    match daemon_ctrl::ensure_running(config).await {
        Ok(result) => {
            println!("{}", daemon_ctrl::describe(result));
            Ok(())
        }
        Err(e) => {
            eprintln!("Cannot open dashboard without a daemon: {e:#}");
            Err(e)
        }
    }
}

fn print_banner(config: &std::path::Path) {
    println!();
    println!("╔══════════════════════════════════════════════════════════╗");
    println!(
        "║     ProxyHubb Provider Node — Console  v{:<14}║",
        env!("CARGO_PKG_VERSION")
    );
    println!("╚══════════════════════════════════════════════════════════╝");
    println!();
    println!("  Config: {}", config.display());
    if config.is_file() {
        println!("  Config file: found ✓");
    } else {
        println!("  Config file: missing — get provider.toml from the dashboard first");
    }
}

fn wait_enter() {
    print!("\n  Press Enter to continue… ");
    let _ = io::stdout().flush();
    let mut buf = String::new();
    let _ = io::stdin().read_line(&mut buf);
}
