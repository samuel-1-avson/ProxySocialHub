use crate::paths;
use std::path::Path;

pub fn print_paths_and_hints() {
    println!("--- Provider Node paths ---");
    println!("State dir:    {}", paths::state_dir().display());
    println!("Config:       {}", paths::config_file().display());
    println!("PID file:     {}", paths::pid_file().display());
    println!("Runtime:      {}", paths::runtime_state_file().display());
    println!("Log file:     {}", paths::log_file().display());
    println!();
    println!("Recommended flow:");
    println!("  provider-node register --api-key <TOKEN>");
    println!("  provider-node doctor");
    println!("  provider-node start");
    println!("  provider-node dashboard");
    println!();

    if let Ok(path) = which_provider_node() {
        println!("provider-node binary: {}", path.display());
    } else {
        println!("provider-node: not found on PATH (download from dashboard or set PROXYHUB_PROVIDER_NODE)");
    }

    #[cfg(windows)]
    {
        println!();
        println!("Windows service (manual): use NSSM or sc.exe with:");
        println!(
            "  {} start --config {}",
            which_provider_node()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|_| "provider-node.exe".into()),
            paths::config_file().display()
        );
    }
}

fn which_provider_node() -> Result<std::path::PathBuf, ()> {
    let name = if cfg!(windows) {
        "provider-node.exe"
    } else {
        "provider-node"
    };
    if let Ok(p) = std::env::var("PROXYHUB_PROVIDER_NODE") {
        let path = Path::new(&p);
        if path.is_file() {
            return Ok(path.to_path_buf());
        }
    }
    let paths_var = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&paths_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(())
}
