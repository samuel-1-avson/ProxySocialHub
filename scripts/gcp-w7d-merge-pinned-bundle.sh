#!/usr/bin/env bash
# Merge a foreign operator into the Host-A pinned bundle file.
# File write only — does not restart control-api.
set -euo pipefail
PIN="${1:-/opt/proxyhubb/ops/operators-bundle.json}"
EXT="${2:-/tmp/operators-ext.json}"
python3 - "$PIN" "$EXT" <<'PY'
import json, sys, time
pin_path, ext_path = sys.argv[1], sys.argv[2]
base = json.load(open(pin_path))
ext = json.load(open(ext_path))
if "signing_key" in open(ext_path, encoding="utf-8").read():
    sys.stderr.write("FAIL: ext bundle contains signing_key\n")
    sys.exit(2)
ops = {o["slug"]: o for o in (base.get("operators") or [])}
for o in (ext.get("operators") or []):
    if o.get("slug") in ("edge-a", "edge-b"):
        continue
    ops[o["slug"]] = o
base["operators"] = list(ops.values())
base["issued_at"] = int(time.time())
out = "/tmp/operators-bundle.merged.json"
json.dump(base, open(out, "w"), indent=2)
print("merged=%s pinned_n=%d slugs=%s" % (out, len(base["operators"]), ",".join(sorted(ops))))
PY
