#!/usr/bin/env python3
"""Pack provider CLI auth/update fixes for emergency Testnet deploy."""
from __future__ import annotations

import shutil
import tarfile
from pathlib import Path

ROOT = Path(r"F:/project/proxyhubb")
STAGING = ROOT / "_tmp_provider_cli_fix"
TAR = ROOT / "provider-cli-auth-fix.tar.gz"

FILES = [
    # control-api
    ("services/control-api/internal/api/cli_distribution.go", "services/control-api/internal/api/cli_distribution.go"),
    ("services/control-api/internal/api/provider_token.go", "services/control-api/internal/api/provider_token.go"),
    # web
    ("apps/web/src/lib/provider-config.ts", "web/src/lib/provider-config.ts"),
    ("apps/web/src/lib/api/provider.ts", "web/src/lib/api/provider.ts"),
    ("apps/web/src/components/provider/ProviderNodeConnectPanel.tsx", "web/src/components/provider/ProviderNodeConnectPanel.tsx"),
    ("apps/web/src/app/dashboard/provider/cli/page.tsx", "web/src/app/dashboard/provider/cli/page.tsx"),
    ("apps/web/src/app/dashboard/provider/setup/page.tsx", "web/src/app/dashboard/provider/setup/page.tsx"),
]

if STAGING.exists():
    shutil.rmtree(STAGING)
STAGING.mkdir(parents=True)

for src_rel, dst_rel in FILES:
    src = ROOT / src_rel
    if not src.exists():
        raise SystemExit(f"missing {src}")
    dst = STAGING / dst_rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)

if TAR.exists():
    TAR.unlink()
with tarfile.open(TAR, "w:gz") as tar:
    for p in STAGING.rglob("*"):
        if p.is_file():
            tar.add(p, arcname=str(p.relative_to(STAGING)).replace("\\", "/"))

ops = ROOT / "_tmp_ops_provider_cli_fix.sh"
ops.write_text(
    """#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
TAR=/tmp/provider-cli-auth-fix.tar.gz
echo "=== extract $TAR ==="
tar -xzf "$TAR" -C /tmp/provider-cli-auth-extract-$$ 2>/dev/null || true
EXTRACT=/tmp/provider-cli-auth-extract-$$
rm -rf "$EXTRACT"
mkdir -p "$EXTRACT"
tar -xzf "$TAR" -C "$EXTRACT"

install_file() {
  local src="$1" dst="$2"
  mkdir -p "$(dirname "$dst")"
  # strip CRLF just in case
  tr -d '\\015' <"$src" >"$dst"
  echo "installed $dst"
}

install_file "$EXTRACT/services/control-api/internal/api/cli_distribution.go" \\
  services/control-api/internal/api/cli_distribution.go
install_file "$EXTRACT/services/control-api/internal/api/provider_token.go" \\
  services/control-api/internal/api/provider_token.go

# web sources live under apps/web locally; emergency build expects apps/web
mkdir -p apps
if [[ -d "$EXTRACT/web" ]]; then
  # merge into apps/web
  mkdir -p apps/web
  cp -a "$EXTRACT/web/." apps/web/
  echo "web sources merged into apps/web"
fi

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== rebuild control-api ==="
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --force-recreate control-api
for i in $(seq 1 40); do
  st=$(docker inspect -f '{{.State.Health.Status}}' proxyhubb-control-api-1 2>/dev/null || echo missing)
  echo "api try=$i health=$st"
  [[ "$st" == "healthy" ]] && break
  sleep 3
done

echo "=== emergency web build ==="
export ALLOW_EMERGENCY_WEB_BUILD=1
# pack web-only tar for the emergency script
WEB_ONLY=/tmp/provider-cli-web-only.tar.gz
tar -C "$EXTRACT" -czf "$WEB_ONLY" web
export WEB_TAR="$WEB_ONLY"
bash scripts/gcp-deploy-web-emergency-build.sh

echo "=== smoke public CLI latest ==="
curl -sS -m 15 "http://127.0.0.1:18080/v1/cli/downloads/latest?platform=windows&arch=amd64&package_type=daemon" || true
echo
echo PROVIDER_CLI_AUTH_DEPLOY_DONE
""",
    encoding="utf-8",
    newline="\n",
)
print(f"packed {TAR} bytes={TAR.stat().st_size}")
print(f"ops {ops}")
