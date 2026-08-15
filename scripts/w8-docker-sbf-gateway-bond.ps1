# Wave 8 / P0.4 — Docker SBF build for programs/gateway-bond.
# Same rust:1.89-trixie + edition2024 pins as proxyhub SBF. Not programs/session.
#
#   powershell -File scripts/w8-docker-sbf-gateway-bond.ps1

param(
    [string]$Image = "rust:1.89-trixie"
)

$ErrorActionPreference = "Stop"
Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dockerRoot = $Root -replace "\\", "/"
$script = "/workspace/scripts/docker-build-gateway-bond.sh"

Write-Host "=== W8 gateway-bond Docker SBF ($Image) ==="
docker run --rm `
  -v "${dockerRoot}:/workspace" `
  -v "proxyhubb-solana-cache:/root/.cache/solana" `
  -v "proxyhubb-solana-install:/root/.local/share/solana" `
  -v "proxyhubb-cargo-registry:/usr/local/cargo/registry" `
  -w /workspace `
  $Image `
  bash -lc "tr -d '\015' < $script | bash"
if ($LASTEXITCODE -ne 0) { throw "docker SBF build failed" }

$so = Join-Path $Root "programs\gateway-bond\target\deploy\proxy_gateway_bond.so"
if (-not (Test-Path $so)) { throw "missing $so" }
$sha = (Get-FileHash $so -Algorithm SHA256).Hash.ToUpperInvariant()
Write-Host "so_size=$((Get-Item $so).Length) sha256=$sha"
Write-Host "W8_GATEWAY_BOND_SBF_OK"
