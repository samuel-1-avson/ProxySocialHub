import bs58 from 'bs58';

/**
 * Build provider-node / proxyhubb-cli config for machines outside the repo.
 * Secrets (api_key) are only included when supplied from the current browser session.
 */

const STORAGE_KEY = 'proxyhubb_provider_api_key';
const SIGNING_KEY_STORAGE_KEY = 'proxyhubb_provider_signing_key';

function apiKeyStorageKey(nodeId?: string | null): string {
    if (nodeId) return `${STORAGE_KEY}_${nodeId}`;
    return STORAGE_KEY;
}

export interface ProviderEndpoints {
    controlApiUrl: string;
    gatewayTunnelAddr: string;
    gatewayTunnelAddrs: string[];
    useTls: boolean;
    tlsSkipVerify: boolean;
}

function isLocalHost(host: string): boolean {
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isIpv4(host: string): boolean {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** Never emit raw VM IPs / localhost when talking to production ProxyHubb. */
export function sanitizeProviderEndpoints(endpoints: ProviderEndpoints): ProviderEndpoints {
    const fallback = getProviderEndpointsRaw();
    let controlApiUrl = endpoints.controlApiUrl?.replace(/\/$/, '') || fallback.controlApiUrl;
    if (
        (controlApiUrl.includes('localhost') || controlApiUrl.includes('127.0.0.1')) &&
        fallback.controlApiUrl.includes('proxyhubb.com')
    ) {
        controlApiUrl = fallback.controlApiUrl;
    }

    const rewriteAddr = (addr: string): string => {
        const cleaned = addr.replace(/^https?:\/\//, '').trim();
        if (!cleaned) return cleaned;
        const host = cleaned.split(':')[0]?.trim() ?? '';
        const port = cleaned.includes(':') ? cleaned.split(':').slice(1).join(':') : '3128';
        if (isLocalHost(host) && controlApiUrl.includes('proxyhubb.com')) {
            return `proxy.proxyhubb.com:${port}`;
        }
        if (isIpv4(host)) {
            return `proxy.proxyhubb.com:${port}`;
        }
        return cleaned;
    };

    const gatewayTunnelAddr = rewriteAddr(endpoints.gatewayTunnelAddr || fallback.gatewayTunnelAddr);
    const gatewayHost = gatewayTunnelAddr.split(':')[0]?.trim() ?? '';
    const isLocal = isLocalHost(gatewayHost);
    const useTls = !isLocal;
    const tlsSkipVerify = false;

    const gatewayTunnelAddrs: string[] = [];
    const pushAddr = (a: string) => {
        const v = rewriteAddr(a);
        if (!v || gatewayTunnelAddrs.includes(v)) return;
        gatewayTunnelAddrs.push(v);
    };
    pushAddr(gatewayTunnelAddr);
    for (const a of endpoints.gatewayTunnelAddrs ?? []) pushAddr(a);
    for (const a of fallback.gatewayTunnelAddrs) pushAddr(a);
    if (!isLocal && gatewayTunnelAddr.endsWith(':3128')) {
        pushAddr(`${gatewayHost}:8443`);
    }

    return {
        controlApiUrl,
        gatewayTunnelAddr,
        gatewayTunnelAddrs,
        useTls,
        tlsSkipVerify,
    };
}

function getProviderEndpointsRaw(): ProviderEndpoints {
    const raw =
        process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:18080';
    const controlApiUrl =
        raw.includes('example.com')
            ? 'https://api.proxyhubb.com'
            : raw;
    const gatewayTunnelAddr =
        process.env.NEXT_PUBLIC_PROVIDER_TUNNEL_ADDR?.replace(/^https?:\/\//, '') ||
        (controlApiUrl.includes('proxyhubb.com') ? 'proxy.proxyhubb.com:3128' : 'localhost:3128');
    const gatewayHost = gatewayTunnelAddr.split(':')[0]?.trim() ?? '';
    const isLocal = isLocalHost(gatewayHost) || gatewayTunnelAddr.startsWith('localhost:');
    const isIpGateway = isIpv4(gatewayHost);
    const useTls = !isLocal;
    const tlsSkipVerify = isIpGateway;
    const gatewayTunnelAddrs: string[] = [];
    const pushAddr = (a: string) => {
        const v = a.trim().replace(/^https?:\/\//, '');
        if (!v || gatewayTunnelAddrs.includes(v)) return;
        gatewayTunnelAddrs.push(v);
    };
    pushAddr(gatewayTunnelAddr);
    if (!isLocal && gatewayTunnelAddr.endsWith(':3128')) {
        pushAddr(`${gatewayHost}:8443`);
    }
    const extra = process.env.NEXT_PUBLIC_PROVIDER_TUNNEL_ADDRS?.split(',') ?? [];
    for (const a of extra) pushAddr(a);
    return { controlApiUrl, gatewayTunnelAddr, gatewayTunnelAddrs, useTls, tlsSkipVerify };
}

export function getProviderEndpoints(): ProviderEndpoints {
    return sanitizeProviderEndpoints(getProviderEndpointsRaw());
}

export function saveProviderApiKey(token: string, nodeId?: string | null) {
    if (typeof window === 'undefined' || !token) return;
    try {
        sessionStorage.setItem(apiKeyStorageKey(nodeId), token);
        // Keep legacy global key for older Connect flows.
        sessionStorage.setItem(STORAGE_KEY, token);
    } catch {
        /* quota / private mode */
    }
}

export function loadProviderApiKey(nodeId?: string | null): string | null {
    if (typeof window === 'undefined') return null;
    try {
        if (nodeId) {
            const perNode = sessionStorage.getItem(apiKeyStorageKey(nodeId));
            if (perNode) return perNode;
        }
        return sessionStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

export function clearProviderApiKey(nodeId?: string | null) {
    if (typeof window === 'undefined') return;
    try {
        if (nodeId) sessionStorage.removeItem(apiKeyStorageKey(nodeId));
        sessionStorage.removeItem(STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

export function generateProviderSigningKey(): string {
    const seed = new Uint8Array(32);
    crypto.getRandomValues(seed);
    return bs58.encode(seed);
}

function signingStorageKey(nodeId?: string | null): string {
    if (nodeId) return `${SIGNING_KEY_STORAGE_KEY}_${nodeId}`;
    return SIGNING_KEY_STORAGE_KEY;
}

export function saveProviderSigningKey(key: string, nodeId?: string | null) {
    if (typeof window === 'undefined' || !key) return;
    try {
        localStorage.setItem(signingStorageKey(nodeId), key);
        if (nodeId) {
            // Keep legacy global key in sync for older Connect flows.
            localStorage.setItem(SIGNING_KEY_STORAGE_KEY, key);
        }
        sessionStorage.removeItem(SIGNING_KEY_STORAGE_KEY);
    } catch {
        /* quota / private mode */
    }
}

export function loadProviderSigningKey(nodeId?: string | null): string | null {
    if (typeof window === 'undefined') return null;
    try {
        if (nodeId) {
            const perNode = localStorage.getItem(signingStorageKey(nodeId));
            if (perNode) return perNode;
        }
        const fromLocal = localStorage.getItem(SIGNING_KEY_STORAGE_KEY);
        if (fromLocal) return fromLocal;
        const fromSession = sessionStorage.getItem(SIGNING_KEY_STORAGE_KEY);
        if (fromSession) {
            localStorage.setItem(SIGNING_KEY_STORAGE_KEY, fromSession);
            sessionStorage.removeItem(SIGNING_KEY_STORAGE_KEY);
            return fromSession;
        }
        return null;
    } catch {
        return null;
    }
}

export function getOrCreateProviderSigningKey(nodeId?: string | null): string | null {
    if (typeof window === 'undefined') return null;
    const existing = loadProviderSigningKey(nodeId);
    if (existing) return existing;
    const generated = generateProviderSigningKey();
    saveProviderSigningKey(generated, nodeId);
    return generated;
}

export interface BuildProviderTomlInput {
    nodeId: string;
    apiKey?: string | null;
    providerSigningKey?: string | null;
    connectionType?: string;
    endpoints?: ProviderEndpoints;
}

export function buildProviderToml(input: BuildProviderTomlInput): string {
    const endpoints = sanitizeProviderEndpoints(input.endpoints ?? getProviderEndpoints());
    const signingKey =
        input.providerSigningKey || getOrCreateProviderSigningKey(input.nodeId);
    const lines = [
        `# ProxyHubb provider-node config — generated by Dashboard Connect`,
        `# Do not edit by hand. Re-download or run: provider-node join`,
        `control_api_url = "${endpoints.controlApiUrl}"`,
        `gateway_addr = "${endpoints.gatewayTunnelAddr}"`,
    ];
    const failover = (endpoints.gatewayTunnelAddrs ?? []).filter(
        (a) => a && a !== endpoints.gatewayTunnelAddr,
    );
    if (failover.length > 0) {
        lines.push(
            `gateway_addrs = [${failover.map((a) => `"${a}"`).join(', ')}]`,
        );
    }
    lines.push(
        `node_id = "${input.nodeId}"`,
        `connection_type = "${input.connectionType ?? 'residential'}"`,
        `use_tls = ${endpoints.useTls}`,
        `tls_skip_verify = ${endpoints.tlsSkipVerify}`,
        'jwt_token = ""',
    );
    if (input.apiKey) {
        lines.push(`api_key = "${input.apiKey}"`);
    } else {
        lines.push('# api_key = "<missing — create a token in Dashboard Connect>"');
    }
    lines.push(`provider_signing_key = "${signingKey}"`);
    return `${lines.join('\n')}\n`;
}

export function defaultProviderConfigPath(): string {
    if (typeof navigator !== 'undefined') {
        const p = (navigator.platform || navigator.userAgent || '').toLowerCase();
        if (p.includes('win')) {
            return '%APPDATA%\\proxyhubb\\provider.toml';
        }
    }
    return '~/.config/proxyhubb/provider.toml';
}

export function buildStartCommand(_configPath = defaultProviderConfigPath()): string {
    // Default path is always used when --config is omitted.
    return 'provider-node start';
}

/** One-shot CLI install for users who already have provider-node on PATH. */
export function buildJoinCommand(apiKey: string, nodeId: string, apiUrl?: string): string {
    const url = apiUrl || getProviderEndpoints().controlApiUrl;
    const parts = [
        'provider-node join',
        '--force',
        `--api-key "${apiKey}"`,
        `--node-id "${nodeId}"`,
    ];
    if (url && !url.includes('localhost')) {
        parts.push(`--api-url "${url}"`);
    }
    return parts.join(' ');
}

/** PowerShell that writes provider.toml to the canonical Windows path (no hand-editing). */
export function buildWindowsInstallScript(toml: string): string {
    const escaped = toml.replace(/'/g, "''");
    return [
        `$dir = Join-Path $env:APPDATA 'proxyhubb'`,
        `New-Item -ItemType Directory -Force -Path $dir | Out-Null`,
        `$path = Join-Path $dir 'provider.toml'`,
        `@'`,
        escaped.trimEnd(),
        `'@ | Set-Content -Encoding utf8 $path`,
        `Write-Host "Wrote $path"`,
        `Write-Host "Next: provider-node stop; provider-node start"`,
        `Write-Host "Then: provider-node doctor"`,
    ].join('\n');
}

/**
 * One-shot Windows setup for non-technical users:
 * write AppData config, download provider-node if needed, stop/start, doctor.
 */
export function buildWindowsSetupThisPcScript(toml: string, apiBase = 'https://api.proxyhubb.com'): string {
    const escaped = toml.replace(/'/g, "''");
    const api = apiBase.replace(/\/$/, '').replace(/'/g, "''");
    return [
        `$ErrorActionPreference = 'Stop'`,
        `Write-Host ''`,
        `Write-Host 'ProxyHubb — Setup this PC' -ForegroundColor Cyan`,
        `Write-Host 'This writes your node config, installs the CLI if needed, and starts it.'`,
        `Write-Host ''`,
        `$cfgDir = Join-Path $env:APPDATA 'proxyhubb'`,
        `New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null`,
        `$cfgPath = Join-Path $cfgDir 'provider.toml'`,
        `@'`,
        escaped.trimEnd(),
        `'@ | Set-Content -Encoding utf8 $cfgPath`,
        `Write-Host "OK  Config saved to $cfgPath" -ForegroundColor Green`,
        `$binDir = Join-Path $env:LOCALAPPDATA 'proxyhubb\\bin'`,
        `New-Item -ItemType Directory -Force -Path $binDir | Out-Null`,
        `$exe = Join-Path $binDir 'provider-node.exe'`,
        `$candidates = @(`,
        `  $exe,`,
        `  (Join-Path $env:USERPROFILE 'Downloads\\provider-node-1.0.6-windows-amd64\\provider-node-1.0.6-windows-amd64.exe'),`,
        `  (Join-Path $env:USERPROFILE 'Downloads\\provider-node-1.0.5-windows-amd64\\provider-node-1.0.5-windows-amd64.exe'),`,
        `  (Join-Path $env:USERPROFILE 'Downloads\\provider-node-1.0.6-windows-amd64.exe'),`,
        `  (Join-Path $env:USERPROFILE 'Downloads\\provider-node-1.0.5-windows-amd64.exe')`,
        `) | Where-Object { $_ -and (Test-Path $_) }`,
        `if (-not $candidates -or -not (Test-Path $exe)) {`,
        `  Write-Host 'Downloading provider-node (latest)...'`,
        `  $tmp = Join-Path $env:TEMP ('proxyhubb-node-' + [guid]::NewGuid().ToString() + '.bin')`,
        `  $url = '${api}/v1/cli/download?platform=windows&arch=amd64&package_type=daemon'`,
        `  Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing`,
        `  $isZip = $false`,
        `  try {`,
        `    $bytes = [System.IO.File]::ReadAllBytes($tmp)`,
        `    if ($bytes.Length -ge 2 -and $bytes[0] -eq 0x50 -and $bytes[1] -eq 0x4B) { $isZip = $true }`,
        `  } catch {}`,
        `  if ($isZip) {`,
        `    $unzip = Join-Path $env:TEMP ('proxyhubb-unz-' + [guid]::NewGuid().ToString())`,
        `    New-Item -ItemType Directory -Force -Path $unzip | Out-Null`,
        `    Expand-Archive -LiteralPath $tmp -DestinationPath $unzip -Force`,
        `    $found = Get-ChildItem -Path $unzip -Recurse -Filter 'provider-node*.exe' | Select-Object -First 1`,
        `    if (-not $found) { throw 'Download zip did not contain provider-node.exe' }`,
        `    Copy-Item -Force $found.FullName $exe`,
        `    Remove-Item -Recurse -Force $unzip -ErrorAction SilentlyContinue`,
        `  } else {`,
        `    Copy-Item -Force $tmp $exe`,
        `  }`,
        `  Remove-Item -Force $tmp -ErrorAction SilentlyContinue`,
        `  Write-Host "OK  CLI installed to $exe" -ForegroundColor Green`,
        `} else {`,
        `  if (-not (Test-Path $exe) -and $candidates) { Copy-Item -Force $candidates[0] $exe }`,
        `  Write-Host "OK  Using CLI at $exe" -ForegroundColor Green`,
        `}`,
        `Remove-Item -Force (Join-Path $env:USERPROFILE '.proxyhubb\\provider.pid') -ErrorAction SilentlyContinue`,
        `try { & $exe stop | Out-Host } catch {}`,
        `Write-Host 'Starting node...'`,
        `Start-Process -FilePath $exe -ArgumentList @('start') -WindowStyle Hidden`,
        `Start-Sleep -Seconds 4`,
        `Write-Host ''`,
        `Write-Host 'Running health check...'`,
        `& $exe doctor`,
        `Write-Host ''`,
        `Write-Host 'Done. Keep this PC on and connected to the internet.' -ForegroundColor Cyan`,
        `Write-Host 'Open Dashboard → My nodes to confirm ONLINE.'`,
        `Write-Host ''`,
    ].join('\n');
}

/** Double-clickable launcher that runs the setup script with ExecutionPolicy Bypass. */
export function buildWindowsSetupCmdWrapper(): string {
    return [
        '@echo off',
        'title ProxyHubb Provider Setup',
        'echo.',
        'echo  ProxyHubb Provider Setup',
        'echo  ------------------------',
        'echo.',
        'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-ProxyHubb-Provider.ps1"',
        'echo.',
        'pause',
        '',
    ].join('\r\n');
}

/** Bash that writes provider.toml to ~/.config/proxyhubb (no hand-editing). */
export function buildUnixInstallScript(toml: string): string {
    return [
        'mkdir -p ~/.config/proxyhubb',
        "cat > ~/.config/proxyhubb/provider.toml << 'PROXYHUBB_EOF'",
        toml.trimEnd(),
        'PROXYHUBB_EOF',
        'echo "Wrote ~/.config/proxyhubb/provider.toml"',
        'echo "Next: provider-node stop && provider-node start"',
        'echo "Then: provider-node doctor"',
    ].join('\n');
}

/**
 * One-shot macOS/Linux setup: write config, prefer existing binary, otherwise curl download.
 */
export function buildUnixSetupThisPcScript(toml: string, apiBase = 'https://api.proxyhubb.com'): string {
    const api = apiBase.replace(/\/$/, '');
    return [
        'set -euo pipefail',
        'echo ""',
        'echo "ProxyHubb — Setup this PC"',
        'mkdir -p ~/.config/proxyhubb',
        "cat > ~/.config/proxyhubb/provider.toml << 'PROXYHUBB_EOF'",
        toml.trimEnd(),
        'PROXYHUBB_EOF',
        'echo "OK  Config saved to ~/.config/proxyhubb/provider.toml"',
        'BIN_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/proxyhubb/bin"',
        'mkdir -p "$BIN_DIR"',
        'EXE="$BIN_DIR/provider-node"',
        'OS=$(uname -s | tr "[:upper:]" "[:lower:]")',
        'ARCH=$(uname -m)',
        'case "$OS" in darwin) PLAT=macos ;; *) PLAT=linux ;; esac',
        'case "$ARCH" in arm64|aarch64) A=arm64 ;; *) A=amd64 ;; esac',
        'if [ ! -x "$EXE" ]; then',
        `  echo "Downloading provider-node..."`,
        `  curl -fsSL "${api}/v1/cli/download?platform=$PLAT&arch=$A&package_type=daemon" -o "$EXE.download"`,
        '  if file "$EXE.download" | grep -qi zip; then',
        '    TMP=$(mktemp -d)',
        '    unzip -o "$EXE.download" -d "$TMP" >/dev/null',
        '    FOUND=$(find "$TMP" -type f -name "provider-node*" | head -n1)',
        '    cp "$FOUND" "$EXE"',
        '    rm -rf "$TMP"',
        '  else',
        '    mv "$EXE.download" "$EXE"',
        '  fi',
        '  chmod +x "$EXE"',
        '  echo "OK  CLI installed to $EXE"',
        'fi',
        '"$EXE" stop >/dev/null 2>&1 || true',
        'nohup "$EXE" start >/dev/null 2>&1 &',
        'sleep 3',
        '"$EXE" doctor || true',
        'echo ""',
        'echo "Done. Keep this machine online. Check Dashboard → My nodes."',
        '',
    ].join('\n');
}

export function isWindowsClient(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /win/i.test(navigator.platform || '') || /windows/i.test(navigator.userAgent || '');
}

export function downloadTextFile(filename: string, contents: string, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function downloadProviderToml(filename: string, contents: string) {
    downloadTextFile(filename, contents, 'application/toml;charset=utf-8');
}

/** Windows: download a .ps1 that writes %APPDATA%\\proxyhubb\\provider.toml when run. */
export function downloadWindowsApplyScript(toml: string) {
    downloadTextFile('Apply-ProxyHubb-Provider.ps1', `${buildWindowsInstallScript(toml)}\n`);
}

/** Download the full Setup-this-PC pack (ps1 + cmd on Windows). */
export function downloadSetupThisPc(toml: string, apiBase?: string) {
    if (isWindowsClient()) {
        const ps1 = buildWindowsSetupThisPcScript(toml, apiBase);
        downloadTextFile('Setup-ProxyHubb-Provider.ps1', ps1);
        // Slight delay so the browser queues both downloads.
        setTimeout(() => {
            downloadTextFile('Setup-ProxyHubb-Provider.cmd', buildWindowsSetupCmdWrapper());
        }, 250);
        return 'windows' as const;
    }
    downloadTextFile('setup-proxyhubb-provider.sh', buildUnixSetupThisPcScript(toml, apiBase));
    return 'unix' as const;
}

/** Prefer an apply script on Windows; raw toml elsewhere (still needs manual install). */
export function downloadProviderConfig(toml: string) {
    if (isWindowsClient()) {
        downloadWindowsApplyScript(toml);
        return 'ps1' as const;
    }
    downloadProviderToml('provider.toml', toml);
    return 'toml' as const;
}
