#!/usr/bin/env bash
# Inspect oracle key material shape (no secret dump) and restore usable keypair.
set -euo pipefail
cd /opt/proxyhubb
python3 <<'PY'
import json, os, glob
cands = [
  "tmp_oracle.json",
  "infra/oracle-keypair.json",
  "infra/oracle-keypair.json.example",
]
# also search shallow
for p in glob.glob("**/*oracle*.json", recursive=False):
  cands.append(p)
for p in ["/opt/proxyhubb/secrets/multisig-cosigner.json"]:
  cands.append(p)
seen=set()
for p in cands:
  if p in seen or not os.path.isfile(p):
    continue
  seen.add(p)
  try:
    raw=json.load(open(p))
  except Exception as e:
    print(f"{p}: NOT_JSON {e}")
    continue
  if isinstance(raw, list):
    print(f"{p}: list len={len(raw)} first_type={type(raw[0]).__name__ if raw else None}")
  elif isinstance(raw, dict):
    keys=sorted(raw.keys())
    print(f"{p}: dict keys={keys}")
    for k in ("secretKey","secret_key","keypair","privateKey","private_key"):
      if k in raw:
        v=raw[k]
        print(f"  nested {k} type={type(v).__name__} len={len(v) if hasattr(v,'__len__') else '?'}")
  else:
    print(f"{p}: type={type(raw).__name__}")
PY

echo "=== secrets list (oracle-ish) ==="
gcloud secrets list --project=gen-lang-client-0022105784 --format='value(name)' 2>/dev/null | grep -Ei 'oracle|keypair|solana' || true
