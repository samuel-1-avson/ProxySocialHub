#!/usr/bin/env bash
# Verify the single live web container + hostname redirect policy.
#
# Usage (on GCE VM):
#   ./scripts/gcp-verify-web-deploy.sh
#
# Env overrides:
#   PROXYHUBB_WEB_CANONICAL_URL  (default https://proxyhubb.com)
#   PROXYHUBB_WEB_ALIAS_URLS     (default www + app)
#   PROXYHUBB_WEB_CONTAINER      (default proxyhubb-web-1)
#   REQUIRE_GHCR=1               fail if image is not from ghcr.io
#   REQUIRE_REDIRECTS=1          fail if aliases do not 301/308 to apex

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/lib/gcp-web-policy.sh
source "$SCRIPT_DIR/lib/gcp-web-policy.sh"

CONTAINER="${PROXYHUBB_WEB_CONTAINER}"
CANONICAL="${PROXYHUBB_WEB_CANONICAL_URL}"
# shellcheck disable=SC2206
ALIASES=( ${PROXYHUBB_WEB_ALIAS_URLS} )
REQUIRE_GHCR="${REQUIRE_GHCR:-0}"
REQUIRE_REDIRECTS="${REQUIRE_REDIRECTS:-0}"
FAIL=0

pass() { echo "PASS  $*"; }
warn() { echo "WARN  $*"; }
fail() { echo "FAIL  $*"; FAIL=1; }

echo "=== web container ==="
if ! sudo docker inspect "$CONTAINER" >/dev/null 2>&1; then
  fail "container missing: $CONTAINER"
  echo "DONE fail=$FAIL"
  exit 1
fi

CREATED=$(sudo docker inspect "$CONTAINER" --format '{{.Created}}')
IMAGE=$(sudo docker inspect "$CONTAINER" --format '{{.Config.Image}}')
IMAGE_ID=$(sudo docker inspect "$CONTAINER" --format '{{.Image}}')
pass "created=$CREATED"
pass "image=$IMAGE"
pass "image_id=$IMAGE_ID"

if echo "$IMAGE" | grep -qi 'ghcr.io/'; then
  pass "deploy_path=ghcr"
elif echo "$IMAGE" | grep -Eqi 'proxyhubb[-_/]?web|web:|sha256:'; then
  warn "deploy_path=local_or_unnamed (prefer GHCR via ./scripts/gcp-deploy-web.sh)"
  if [[ "$REQUIRE_GHCR" == "1" ]]; then
    fail "REQUIRE_GHCR=1 but image is not ghcr.io: $IMAGE"
  fi
else
  warn "deploy_path=unknown image=$IMAGE"
  if [[ "$REQUIRE_GHCR" == "1" ]]; then
    fail "REQUIRE_GHCR=1 but image is not ghcr.io: $IMAGE"
  fi
fi

echo "=== env (baked public API) ==="
sudo docker exec "$CONTAINER" printenv 2>/dev/null \
  | grep -E 'NEXT_PUBLIC_API|API_URL|ENABLE_EVM' \
  | sort || warn "could not read container env"

echo "=== local routes :3000 ==="
for path in / /dashboard/wallet /marketplace/orders /dashboard/sessions /onboarding /login; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000$path" || echo fail)
  if [[ "$code" =~ ^(200|301|302|307|308)$ ]]; then
    pass "local$path=$code"
  else
    fail "local$path=$code"
  fi
done

LOCAL_BODY=$(curl -sS "http://127.0.0.1:3000/" || true)
LOCAL_HASH=$(printf '%s' "$LOCAL_BODY" | sha256sum | awk '{print substr($1,1,16)}')
LOCAL_MARKERS=$(printf '%s' "$LOCAL_BODY" \
  | grep -oE 'decentralized bandwidth|Residential bandwidth|Become a Seller|Become a provider|Get started|Open dashboard|NetworkPulse' \
  | sort -u | tr '\n' ',' | sed 's/,$//')
pass "local_body_sha16=$LOCAL_HASH markers=${LOCAL_MARKERS:-none}"

echo "=== public canonical (follow redirects) ==="
canon_code=$(curl -sS -L -o /dev/null -w '%{http_code}' "$CANONICAL/" || echo fail)
canon_final=$(curl -sS -L -o /dev/null -w '%{url_effective}' "$CANONICAL/" || true)
CANON_BODY=$(curl -sS -L "$CANONICAL/" || true)
CANON_HASH=$(printf '%s' "$CANON_BODY" | sha256sum | awk '{print substr($1,1,16)}')
if [[ "$canon_code" == "200" ]]; then
  pass "canonical=$CANONICAL code=$canon_code final=$canon_final sha16=$CANON_HASH"
else
  fail "canonical=$CANONICAL code=$canon_code"
fi

if [[ -n "$LOCAL_HASH" && -n "$CANON_HASH" && "$LOCAL_HASH" == "$CANON_HASH" ]]; then
  pass "local_matches_canonical_body"
else
  warn "local_sha=$LOCAL_HASH canonical_sha=$CANON_HASH (CDN/cache or origin mismatch)"
fi

echo "=== alias redirect policy (no follow) ==="
for alias in "${ALIASES[@]}"; do
  hdr=$(curl -sS -D - -o /dev/null "$alias/" || true)
  code=$(printf '%s' "$hdr" | awk 'BEGIN{c=""} /^HTTP\//{c=$2} END{print c}')
  loc=$(printf '%s' "$hdr" | awk 'BEGIN{IGNORECASE=1} /^[Ll]ocation:/{sub(/\r$/,""); print $2; exit}')
  # Accept 301/308 to apex, or 200 if already same content during cutover
  if [[ "$code" =~ ^(301|302|307|308)$ ]]; then
    if echo "$loc" | grep -qi 'proxyhubb.com'; then
      pass "alias=$alias code=$code location=$loc"
    else
      fail "alias=$alias code=$code unexpected location=$loc"
    fi
  elif [[ "$code" == "200" ]]; then
    msg="alias=$alias still serves 200 (expected 301 → $CANONICAL after Caddy cutover)"
    if [[ "$REQUIRE_REDIRECTS" == "1" ]]; then
      fail "$msg"
    else
      warn "$msg"
    fi
  else
    fail "alias=$alias code=${code:-none}"
  fi
done

echo "=== compose labels (excerpt) ==="
sudo docker inspect "$CONTAINER" --format '{{json .Config.Labels}}' | head -c 600
echo

echo "DONE fail=$FAIL"
exit "$FAIL"
