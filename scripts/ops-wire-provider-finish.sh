#!/usr/bin/env bash
# Resume after token/listing wire: write config from latest active token raw is lost —
# re-mint is safer. Prefer calling full ops-wire-provider-connect.sh.
# This finish script only rewrites config if RAW_TOKEN is provided, else re-runs full wire.
set -euo pipefail
cd /opt/proxyhubb
if [[ -z "${RAW_TOKEN:-}" ]]; then
  exec bash scripts/ops-wire-provider-connect.sh
fi
LIVE_NODE="${LIVE_NODE:-99d66ece-bee4-4d98-80d6-53f23e85a94a}"
SIGNING_KEY="$(grep -E '^PROXYHUB_PROVIDER_SIGNING_KEY=' config/docker/provider.compose.env 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
export RAW_TOKEN LIVE_NODE SIGNING_KEY
python3 - <<'PY'
from pathlib import Path
import os, re
toml = Path("config/docker/provider.toml")
text = toml.read_text() if toml.exists() else ""
def set_kv(src, key, val):
    pat = re.compile(rf'^{re.escape(key)}\s*=.*$', re.M)
    line = f'{key} = "{val}"'
    if pat.search(src):
        return pat.sub(line, src)
    return src + ("\n" if src and not src.endswith("\n") else "") + line + "\n"
raw = os.environ["RAW_TOKEN"]
node = os.environ["LIVE_NODE"]
sign = os.environ.get("SIGNING_KEY", "")
text = set_kv(text, "api_key", raw)
text = set_kv(text, "node_id", node)
if sign.strip():
    text = set_kv(text, "provider_signing_key", sign)
toml.write_text(text)
Path("config/docker/provider.compose.env").write_text(
    f"PROXYHUB_API_KEY={raw}\nPROXYHUB_PROVIDER_SIGNING_KEY={sign}\n"
)
print("config written")
PY
docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.provider.yml --profile provider up -d --force-recreate provider-node
sleep 10
docker logs proxyhubb-provider-node --tail 50 2>&1
