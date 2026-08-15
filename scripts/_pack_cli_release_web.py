#!/usr/bin/env python3
from pathlib import Path
import shutil
import tarfile

ROOT = Path(r"F:/project/proxyhubb")
STAGING = ROOT / "_tmp_cli_release_web"
TAR = ROOT / "cli-release-web-api.tar.gz"
FILES = [
    ("apps/web/src/app/dashboard/provider/cli/page.tsx", "web/src/app/dashboard/provider/cli/page.tsx"),
    ("apps/web/src/lib/api/provider.ts", "web/src/lib/api/provider.ts"),
    ("services/control-api/internal/api/cli_distribution.go", "services/control-api/internal/api/cli_distribution.go"),
]
if STAGING.exists():
    shutil.rmtree(STAGING)
for src_rel, dst_rel in FILES:
    src = ROOT / src_rel
    dst = STAGING / dst_rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
if TAR.exists():
    TAR.unlink()
with tarfile.open(TAR, "w:gz") as tar:
    for p in STAGING.rglob("*"):
        if p.is_file():
            tar.add(p, arcname=str(p.relative_to(STAGING)).replace("\\", "/"))

(ROOT / "_tmp_ops_cli_release_web.sh").write_text(
    """#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
TAR=/tmp/cli-release-web-api.tar.gz
EXTRACT=/tmp/cli-release-web-extract
rm -rf "$EXTRACT"
mkdir -p "$EXTRACT"
tar -xzf "$TAR" -C "$EXTRACT"
install_file() { mkdir -p "$(dirname "$2")"; tr -d '\\015' <"$1" >"$2"; echo installed "$2"; }
install_file "$EXTRACT/services/control-api/internal/api/cli_distribution.go" \\
  services/control-api/internal/api/cli_distribution.go
mkdir -p apps/web
cp -a "$EXTRACT/web/." apps/web/
# Demote stale 1.0.4 bundle as not-latest so UI latest_version is 1.0.5
docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml \\
  exec -T postgres psql -U proxyhubb -d proxyhubb -c \\
  "UPDATE cli_downloads SET is_latest=false WHERE version='1.0.4' AND package_type='bundle';"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --force-recreate control-api
for i in $(seq 1 40); do
  st=$(docker inspect -f '{{.State.Health.Status}}' proxyhubb-control-api-1 2>/dev/null || echo missing)
  echo "api try=$i $st"
  [[ "$st" == "healthy" ]] && break
  sleep 3
done

export ALLOW_EMERGENCY_WEB_BUILD=1
WEB_ONLY=/tmp/cli-release-web-only.tar.gz
tar -C "$EXTRACT" -czf "$WEB_ONLY" web
export WEB_TAR="$WEB_ONLY"
bash scripts/gcp-deploy-web-emergency-build.sh
curl -sS -m 15 "http://127.0.0.1:18080/v1/cli/downloads/latest?platform=windows&arch=amd64&package_type=daemon"; echo
echo CLI_RELEASE_WEB_API_DONE
""",
    encoding="utf-8",
    newline="\n",
)
print("packed", TAR.stat().st_size)
