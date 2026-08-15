#!/usr/bin/env bash
set -euo pipefail
PROJECT=gen-lang-client-0022105784
echo "=== identity ==="
gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true
curl -sf -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email 2>/dev/null || echo "(no metadata email)"
echo

for sec in proxyhubb-testnet-treasury-legacy-keypair proxyhubb-testnet-treasury-hot-keypair proxyhubb-testnet-treasury-cold-keypair; do
  echo "=== $sec ==="
  set +e
  gcloud secrets versions access latest --secret="$sec" --project="$PROJECT" >/tmp/sm-probe.json 2>/tmp/sm-err.txt
  RC=$?
  set -e
  if [[ $RC -ne 0 ]]; then
    echo "ACCESS_FAIL: $(tr '\n' ' ' </tmp/sm-err.txt | head -c 300)"
    rm -f /tmp/sm-probe.json
    continue
  fi
  python3 - <<'PY'
import json
raw=open("/tmp/sm-probe.json","rb").read()
print(f"bytes={len(raw)}")
try:
  d=json.loads(raw)
except Exception as e:
  print(f"not_json: {e}")
  raise SystemExit(0)
if isinstance(d, list):
  print(f"list_len={len(d)}")
elif isinstance(d, dict):
  print(f"dict_keys={sorted(d.keys())}")
elif isinstance(d, str):
  print(f"str_len={len(d)}")
else:
  print(type(d).__name__)
PY
  rm -f /tmp/sm-probe.json
done
echo SM_SHAPE_DONE
