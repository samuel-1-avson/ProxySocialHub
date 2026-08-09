//! In-place self-update for provider-node.
//!
//! Primary source: Control API public CLI distribution
//! (`GET /v1/cli/downloads/latest` + `/v1/cli/download`).
//! Optional fallback: GitHub Releases (only works when the repo/assets are public).

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const DEFAULT_API_URL: &str = "https://api.proxyhubb.com";
const GITHUB_REPO: &str = "samuel-1-avson/ProxySocialHub";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone)]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub tag: String,
    pub asset_name: String,
    pub asset_url: String,
    pub checksum: Option<String>,
    pub checksum_url: Option<String>,
    pub already_latest: bool,
    pub source: String,
}

#[derive(Debug, Deserialize)]
struct ApiLatest {
    version: String,
    download_url: String,
    checksum: Option<String>,
    filename: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    assets: Vec<GhAsset>,
}

#[derive(Debug, Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

/// Check for a newer provider-node release (no download).
pub async fn check() -> Result<UpdateInfo> {
    match fetch_latest_from_api().await {
        Ok(info) => Ok(info),
        Err(api_err) => match fetch_latest_from_github().await {
            Ok(info) => Ok(info),
            Err(gh_err) => Err(anyhow!(
                "update check failed via Control API ({api_err:#}); GitHub fallback also failed ({gh_err:#}). \
                 Download from Dashboard → Provider → CLI, or set PROXYHUB_API_URL."
            )),
        },
    }
}

/// Download + install the latest release over this binary. Stops the background
/// daemon first so the tunnel process is not left on an old image.
pub async fn run(check_only: bool, yes: bool) -> Result<()> {
    let info = check().await?;
    println!("Current:  v{}", info.current);
    println!(
        "Latest:   v{} ({}) via {}",
        info.latest, info.tag, info.source
    );

    if info.already_latest {
        println!("Already up to date.");
        return Ok(());
    }

    if check_only {
        println!("Update available. Run: provider-node update");
        return Ok(());
    }

    if !yes {
        print!("Install v{} over this binary? [y/N] ", info.latest);
        let _ = std::io::stdout().flush();
        let mut line = String::new();
        std::io::stdin().read_line(&mut line)?;
        if !matches!(line.trim().to_ascii_lowercase().as_str(), "y" | "yes") {
            println!("Cancelled.");
            return Ok(());
        }
    }

    println!("Stopping background daemon (if running)…");
    let _ = crate::daemon_ctrl::stop_if_running().await;

    let exe = std::env::current_exe().context("resolve current executable")?;
    let staging = staging_path(&exe);
    println!("Downloading {}…", info.asset_name);
    let bytes = download_bytes(&info.asset_url).await?;

    if let Some(want) = &info.checksum {
        verify_checksum_hex(&bytes, want)?;
        println!("Checksum OK");
    } else if let Some(sums_url) = &info.checksum_url {
        match verify_sha256(&bytes, &info.asset_name, sums_url).await {
            Ok(()) => println!("Checksum OK"),
            Err(e) => eprintln!("Warning: checksum check skipped/failed: {e:#}"),
        }
    }

    if info.asset_name.ends_with(".zip") {
        bail!(
            "latest asset is a zip ({}) — expected a raw binary asset",
            info.asset_name
        );
    }

    fs::write(&staging, &bytes)
        .with_context(|| format!("write staging binary {}", staging.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&staging)?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&staging, perms)?;
    }

    swap_binaries(&exe, &staging)?;
    println!("Updated to v{} at {}", info.latest, exe.display());
    println!("Restart this console (or run provider-node again) to use the new binary.");
    println!("The daemon was stopped — open the menu or run `provider-node` to start it again.");
    Ok(())
}

pub fn print_check(info: &UpdateInfo) {
    if info.already_latest {
        println!("provider-node v{} — up to date", info.current);
    } else {
        println!(
            "provider-node v{} — update available: v{} ({})",
            info.current, info.latest, info.tag
        );
        println!("Run: provider-node update");
    }
}

fn update_api_base() -> String {
    if let Ok(v) = std::env::var("PROXYHUB_API_URL") {
        let t = v.trim().trim_end_matches('/').to_string();
        if !t.is_empty() {
            return t;
        }
    }
    // Prefer control_api_url from the local provider.toml when present.
    let cfg_path = crate::paths::config_file();
    if let Some(path) = cfg_path.to_str() {
        if let Ok(cfg) = crate::config::Config::load(path) {
            let t = cfg.control_api_url.trim().trim_end_matches('/');
            if !t.is_empty() && !t.contains("localhost") && !t.contains("127.0.0.1") {
                return t.to_string();
            }
        }
    }
    DEFAULT_API_URL.to_string()
}

async fn fetch_latest_from_api() -> Result<UpdateInfo> {
    let (os, arch) = current_target();
    let base = update_api_base();
    let meta_url =
        format!("{base}/v1/cli/downloads/latest?platform={os}&arch={arch}&package_type=daemon");
    let client = http_client(30)?;
    let resp = client
        .get(&meta_url)
        .send()
        .await
        .context("Control API latest metadata request failed")?;
    if !resp.status().is_success() {
        bail!("Control API latest HTTP {}", resp.status());
    }
    let meta: ApiLatest = resp.json().await.context("parse Control API latest")?;
    let version = meta.version.trim().trim_start_matches('v').to_string();
    if version.is_empty() {
        bail!("Control API returned empty version");
    }
    let asset_url = if meta.download_url.starts_with("http") {
        meta.download_url
    } else if meta.download_url.starts_with('/') {
        format!("{base}{}", meta.download_url)
    } else {
        format!(
            "{base}/v1/cli/download?platform={os}&arch={arch}&package_type=daemon&version={version}"
        )
    };
    let asset_name = meta.filename.unwrap_or_else(|| {
        let ext = if os == "windows" { ".exe" } else { "" };
        format!("provider-node-{version}-{os}-{arch}{ext}")
    });
    let already = version_cmp(&version, CURRENT_VERSION) <= 0;
    Ok(UpdateInfo {
        current: CURRENT_VERSION.to_string(),
        latest: version.clone(),
        tag: format!("provider-v{version}"),
        asset_name,
        asset_url,
        checksum: meta.checksum.filter(|s| !s.trim().is_empty()),
        checksum_url: None,
        already_latest: already,
        source: "control-api".to_string(),
    })
}

async fn fetch_latest_from_github() -> Result<UpdateInfo> {
    let repo = std::env::var("PROXYHUB_UPDATE_REPO").unwrap_or_else(|_| GITHUB_REPO.to_string());
    let url = format!("https://api.github.com/repos/{repo}/releases?per_page=20");
    let client = http_client(30)?;
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .context("GitHub releases request failed")?;
    if !resp.status().is_success() {
        if resp.status().as_u16() == 404 {
            bail!(
                "GitHub releases HTTP 404 — repo `{repo}` is private or missing; \
                 self-update uses Control API by default (Dashboard → Provider → CLI)"
            );
        }
        bail!("GitHub releases HTTP {}", resp.status());
    }
    let releases: Vec<GhRelease> = resp.json().await.context("parse GitHub releases")?;
    let release = releases
        .into_iter()
        .find(|r| r.tag_name.starts_with("provider-v"))
        .ok_or_else(|| anyhow!("no provider-v* release found on GitHub"))?;
    let version = tag_to_version(&release.tag_name)?;
    let (asset_name, asset_url) = pick_asset(&release, &version)?;
    let checksum_url = release
        .assets
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case("SHA256SUMS.txt"))
        .map(|a| a.browser_download_url.clone());
    let already = version_cmp(&version, CURRENT_VERSION) <= 0;
    Ok(UpdateInfo {
        current: CURRENT_VERSION.to_string(),
        latest: version,
        tag: release.tag_name,
        asset_name,
        asset_url,
        checksum: None,
        checksum_url,
        already_latest: already,
        source: "github".to_string(),
    })
}

fn http_client(timeout_secs: u64) -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(format!("proxyhubb-provider-node/{CURRENT_VERSION}"))
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()?)
}

fn tag_to_version(tag: &str) -> Result<String> {
    let v = tag
        .strip_prefix("provider-v")
        .or_else(|| tag.strip_prefix('v'))
        .unwrap_or(tag)
        .trim();
    if v.is_empty() {
        bail!("empty version in tag {tag}");
    }
    Ok(v.to_string())
}

fn pick_asset(release: &GhRelease, version: &str) -> Result<(String, String)> {
    let (os, arch) = current_target();
    let ext = if os == "windows" { ".exe" } else { "" };
    let preferred = [
        format!("provider-node-{version}-{os}-{arch}{ext}"),
        format!("provider-node-{version}-{os}-{arch}"),
    ];
    for name in &preferred {
        if let Some(a) = release.assets.iter().find(|a| a.name == *name) {
            return Ok((a.name.clone(), a.browser_download_url.clone()));
        }
    }
    if let Some(a) = release.assets.iter().find(|a| {
        let n = &a.name;
        n.starts_with("provider-node-")
            && n.contains(os)
            && n.contains(arch)
            && !n.contains("provider-cli")
            && !n.ends_with(".zip")
    }) {
        return Ok((a.name.clone(), a.browser_download_url.clone()));
    }
    bail!(
        "no binary asset for {os}/{arch} in {} (need provider-node-*-{os}-{arch}{ext})",
        release.tag_name
    )
}

fn current_target() -> (&'static str, &'static str) {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "amd64"
    };
    (os, arch)
}

async fn download_bytes(url: &str) -> Result<Vec<u8>> {
    let client = http_client(180)?;
    let resp = client.get(url).send().await.context("download failed")?;
    if !resp.status().is_success() {
        bail!("download HTTP {}", resp.status());
    }
    let bytes = resp.bytes().await?;
    Ok(bytes.to_vec())
}

fn verify_checksum_hex(bytes: &[u8], want: &str) -> Result<()> {
    let want = want.trim();
    let want = want
        .strip_prefix("sha256:")
        .or_else(|| want.strip_prefix("SHA256:"))
        .unwrap_or(want);
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let got = format!("{:x}", hasher.finalize());
    if !got.eq_ignore_ascii_case(want) {
        bail!("checksum mismatch: expected {want}, got {got}");
    }
    Ok(())
}

async fn verify_sha256(bytes: &[u8], asset_name: &str, sums_url: &str) -> Result<()> {
    let text = String::from_utf8(download_bytes(sums_url).await?)?;
    let want = parse_sha256sums(&text, asset_name)
        .ok_or_else(|| anyhow!("asset {asset_name} not listed in SHA256SUMS.txt"))?;
    verify_checksum_hex(bytes, &want)
}

fn parse_sha256sums(text: &str, asset_name: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        if name == asset_name || name.ends_with(asset_name) {
            return Some(hash.trim().to_string());
        }
    }
    None
}

fn staging_path(exe: &Path) -> PathBuf {
    let mut p = exe.as_os_str().to_os_string();
    p.push(".new");
    PathBuf::from(p)
}

fn swap_binaries(exe: &Path, staging: &Path) -> Result<()> {
    let backup = {
        let mut p = exe.as_os_str().to_os_string();
        p.push(".old");
        PathBuf::from(p)
    };
    let _ = fs::remove_file(&backup);
    // Windows allows renaming a running executable; delete often fails.
    fs::rename(exe, &backup).with_context(|| {
        format!(
            "could not move {} aside — close other provider-node windows and retry",
            exe.display()
        )
    })?;
    if let Err(e) = fs::rename(staging, exe) {
        let _ = fs::rename(&backup, exe);
        return Err(e).context("install new binary failed; restored previous");
    }
    let _ = fs::remove_file(&backup);
    let _ = fs::remove_file(staging);
    Ok(())
}

fn version_cmp(a: &str, b: &str) -> i32 {
    let pa = parse_ver(a);
    let pb = parse_ver(b);
    for i in 0..3 {
        if pa[i] < pb[i] {
            return -1;
        }
        if pa[i] > pb[i] {
            return 1;
        }
    }
    0
}

fn parse_ver(s: &str) -> [u64; 3] {
    let mut out = [0u64; 3];
    for (i, part) in s.split('.').take(3).enumerate() {
        let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
        out[i] = digits.parse().unwrap_or(0);
    }
    out
}
