#!/usr/bin/env bash
set -euo pipefail
PROJECT=gen-lang-client-0022105784

echo "sizes:"
wc -c /opt/proxyhubb/oracle-keypair.json /opt/proxyhubb/treasury-keypair.json 2>/dev/null || true

offbox_and_shred() {
  local f="$1"
  local name="$2"
  if [ ! -f "$f" ]; then
    echo "skip missing $f"
    return 0
  fi
  local sz
  sz=$(wc -c < "$f" | tr -d ' ')
  if [ "$sz" -gt 10 ]; then
    if ! gcloud secrets describe "$name" --project="$PROJECT" >/dev/null 2>&1; then
      gcloud secrets create "$name" --project="$PROJECT" --replication-policy=automatic
    fi
    sudo cat "$f" | gcloud secrets versions add "$name" --project="$PROJECT" --data-file=-
    echo "offboxed $f -> $name"
  else
    echo "tiny/placeholder $f ($sz bytes) ??? shred without SM"
  fi
  if command -v shred >/dev/null 2>&1; then
    sudo shred -u -n 3 -z "$f"
  else
    sudo rm -f "$f"
  fi
  echo "shredded $f"
}

offbox_and_shred /opt/proxyhubb/oracle-keypair.json proxyhubb-testnet-oracle-keypair
offbox_and_shred /opt/proxyhubb/treasury-keypair.json proxyhubb-testnet-treasury-legacy-keypair

# Quarantine leftovers if any
if [ -d /opt/proxyhubb/secrets/quarantine-20260807 ]; then
  for f in /opt/proxyhubb/secrets/quarantine-20260807/*; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    case "$base" in
      oracle-keypair.json) offbox_and_shred "$f" proxyhubb-testnet-oracle-keypair ;;
      treasury-hot-keypair.json) offbox_and_shred "$f" proxyhubb-testnet-treasury-hot-keypair ;;
      *) offbox_and_shred "$f" "proxyhubb-testnet-quarantine-$(echo "$base" | tr '.' '-')" ;;
    esac
  done
  sudo rm -rf /opt/proxyhubb/secrets/quarantine-20260807
fi

echo "--- remaining custody-like (excl program deploy / examples) ---"
left=$(sudo find /opt/proxyhubb -type f \( \
  -name 'oracle-keypair.json' -o \
  -name 'treasury-hot-keypair.json' -o \
  -name 'treasury-cold-keypair.json' -o \
  -name 'treasury-keypair.json' \
\) 2>/dev/null | grep -v example | grep -v '/target/deploy/' || true)
if [ -n "$left" ]; then
  echo "$left"
  echo FAIL
  exit 1
fi
echo NONE

st=$(sudo docker inspect proxyhubb-control-api-1 --format '{{.State.Health.Status}}')
echo "health=$st"
test "$st" = "healthy"
echo SPRINT_06_KEYS_OFFBOX_OK
