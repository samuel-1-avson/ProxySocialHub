# Canonical provider operator paths (matches provider-node paths.rs and proxyhubb-cli).

function Get-ProviderConfigDir {
    # Match provider-node / proxyhubb-cli (dirs::config_dir → %APPDATA% on Windows).
    if ($env:APPDATA) {
        return Join-Path $env:APPDATA "proxyhubb"
    }
    if ($env:XDG_CONFIG_HOME) {
        return Join-Path $env:XDG_CONFIG_HOME "proxyhubb"
    }
    Join-Path $env:USERPROFILE ".config\proxyhubb"
}

function Get-ProviderConfigPath {
    Join-Path (Get-ProviderConfigDir) "provider.toml"
}

function Get-ProviderLegacyConfigPath {
    Join-Path $env:USERPROFILE ".proxyhubb\provider.toml"
}

function Get-ProviderStateDir {
    Join-Path $env:USERPROFILE ".proxyhubb"
}

function Ensure-ProviderConfigDir {
    $dir = Get-ProviderConfigDir
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

function Resolve-ProviderConfigPath {
    $canonical = Get-ProviderConfigPath
    $legacy = Get-ProviderLegacyConfigPath
    if (Test-Path $canonical) { return $canonical }
    if (Test-Path $legacy) { return $legacy }
    return $canonical
}

function Get-ProviderApiKeyFromToml([string]$tomlPath) {
    if (-not (Test-Path $tomlPath)) { return "" }
    $content = Get-Content $tomlPath -Raw
    $m = [regex]::Match($content, 'api_key\s*=\s*"([^"]*)"')
    if ($m.Success) { return $m.Groups[1].Value.Trim() }
    return ""
}

function Test-ProviderTomlHasUsableKey([string]$tomlPath) {
    $key = Get-ProviderApiKeyFromToml $tomlPath
    return ($key.Length -ge 32 -and $key -notmatch '<|Dashboard|paste')
}

function Get-GatewayTransport {
    # Matches edge-gateway PROVIDER_TRANSPORT (yamux = TCP tunnel, quic = UDP+TLS).
    $t = if ($env:PROVIDER_TRANSPORT) { $env:PROVIDER_TRANSPORT.Trim().ToLower() } else { "" }
    if ($t -in @("quic", "http3", "yamux", "tcp")) { return $t }
    foreach ($name in @("proxyhubb-edge-gateway-1", "proxyhubb-edge-gateway")) {
        try {
            $remote = docker exec $name printenv PROVIDER_TRANSPORT 2>$null
            if ($remote) {
                $remote = $remote.Trim().ToLower()
                if ($remote) { return $remote }
            }
        }
        catch { }
    }
    return "yamux"
}

function Test-DockerProviderNodeRunning {
    try {
        $state = docker inspect -f '{{.State.Running}}' proxyhubb-provider-node 2>$null
        return ($state -eq "true")
    }
    catch {
        return $false
    }
}

function Migrate-ProviderConfigToCanonical {
    $canonical = Get-ProviderConfigPath
    $legacy = Get-ProviderLegacyConfigPath
    $oldXdg = Join-Path $env:USERPROFILE ".config\proxyhubb\provider.toml"
    $sources = @($legacy, $oldXdg) | Where-Object { $_ -and (Test-Path $_) -and $_ -ne $canonical }
    if (Test-Path $canonical) { return }
    foreach ($src in $sources) {
        if (-not (Test-ProviderTomlHasUsableKey $src)) { continue }
        Ensure-ProviderConfigDir
        Copy-Item -Path $src -Destination $canonical -Force
        Write-Host "[OK] Migrated provider.toml to $canonical" -ForegroundColor Green
        return
    }
    if ($sources.Count -gt 0) {
        Write-Host "[WARN] Skipping migration: existing provider.toml has no usable api_key (will mint a new one)." -ForegroundColor Yellow
    }
}
