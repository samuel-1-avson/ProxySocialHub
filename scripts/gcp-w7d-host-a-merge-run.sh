#!/usr/bin/env bash
set -euo pipefail
EXT="${1:-/tmp/operators-ext.json}"
PIN=""
for p in /opt/proxyhubb/ops/operators-bundle.json /etc/proxyhubb/operators-bundle.json; do
  if [[ -f "$p" ]]; then PIN="$p"; break; fi
done
if [[ -z "$PIN" ]]; then
  PIN=$(sudo docker inspect proxyhubb-control-api-1 --format '{{range .Mounts}}{{println .Source}}{{end}}' | grep operators-bundle | head -1 || true)
fi
[[ -n "$PIN" && -f "$PIN" ]] || { echo "FAIL: pinned bundle file not found"; exit 2; }
echo "PIN=$PIN"
before=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
tr -d '\015' < /tmp/gcp-w7d-merge-pinned-bundle.sh | bash -s "$PIN" "$EXT"
sudo cp /tmp/operators-bundle.merged.json "$PIN"
sudo chmod 644 "$PIN"
after=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
echo "BEFORE_STARTED=$before"
echo "AFTER_STARTED=$after"
[[ "$before" == "$after" ]] || { echo "FAIL: control-api restarted"; exit 2; }
echo "W7D_PIN_MERGED_UNTOUCHED"
