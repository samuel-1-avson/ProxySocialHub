//! Interactive console when `provider-node` is launched with no subcommand
//! (e.g. double-click on Windows). Keeps a real window open so operators
//! can pick dashboard / doctor / status without memorizing flags.

use crate::paths;
use std::io::{self, Write};
use std::path::PathBuf;

pub async fn run() -> anyhow::Result<()> {
    let config = paths::config_file();
    print_banner(&config);

    loop {
        println!();
        println!("  [1] Open live dashboard (interactive TUI)");
        println!("  [2] Run doctor (pre-flight checks)");
        println!("  [3] Show status");
        println!("  [4] Start daemon in this window");
        println!("  [5] Print install paths & hints");
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
                println!("\nStarting dashboard… (Ctrl+C to return)\n");
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
            "4" | "start" => {
                println!("\nStarting provider-node daemon…");
                println!("Config: {}", config.display());
                println!("Press Ctrl+C to stop.\n");
                let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("provider-node"));
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
            "5" | "install" | "paths" => {
                println!();
                crate::install::print_paths_and_hints();
                wait_enter();
                print_banner(&config);
            }
            "h" | "help" | "?" => {
                println!();
                println!("First-run checklist:");
                println!("  1. Download provider.toml from Dashboard → My nodes → Connect");
                println!("     (or Setup wizard). Place it at:");
                println!("       {}", config.display());
                println!("  2. Choose [2] doctor — fix any red checks");
                println!("  3. Choose [4] start — leave this window running, OR install as a service");
                println!("  4. Choose [1] dashboard in a second window for live metrics");
                println!();
                println!("Tip: from a terminal you can also run:");
                println!("  provider-node dashboard --config {}", config.display());
                wait_enter();
                print_banner(&config);
            }
            "q" | "quit" | "exit" => {
                println!("Goodbye.");
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

fn print_banner(config: &std::path::Path) {
    println!();
    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║           ProxyHubb Provider Node — Console              ║");
    println!("╚══════════════════════════════════════════════════════════╝");
    println!();
    println!("  Binary is installed and running.");
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
