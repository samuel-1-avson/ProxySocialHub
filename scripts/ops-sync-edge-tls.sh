#!/usr/bin/env bash
# Keep the edge-gateway TLS certificate in sync with the one Caddy renews.
#
# Why: Caddy (host service, :443) obtains and renews the Let's Encrypt cert for
# proxy.proxyhubb.com by itself. The edge gateways instead read
# /opt/proxyhubb/certs/server.{crt,key} (TLS_CERT_PATH / TLS_KEY_PATH) once, at
# startup, and that directory was filled by a one-off copy on 2026-08-06, so it
# expired on its own schedule (2026-10-30) while Caddy's renewed cert sat unused.
# Providers verify this cert on the tunnel ports (:8443 gateway-a, :3129 gateway-b).
#
# What: if Caddy's cert differs from the installed one, validate it (name, key
# pair, remaining lifetime, not older than what is installed), back up the
# installed files, install the new ones atomically, then restart the gateways one
# at a time and confirm each serves the new cert. Any failure restores the backup.
# Restarting a gateway drops its provider tunnels for a few seconds; they
# reconnect on their own.
#
# Usage (root, because Caddy's store is caddy-owned 0600):
#   sudo bash scripts/ops-sync-edge-tls.sh            # sync if needed
#   sudo bash scripts/ops-sync-edge-tls.sh --dry-run  # validate and report only
#   sudo bash scripts/ops-sync-edge-tls.sh --force    # reinstall + restart even if identical
#
# Daily via systemd (installed once, then follows the repo checkout):
#   sudo install -m 644 infra/systemd/proxyhubb-edge-tls-sync.{service,timer} /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now proxyhubb-edge-tls-sync.timer
#
# Env overrides: HOST, CADDY_CERT_DIR, DEST, BACKUP_ROOT, MIN_DAYS, WARN_DAYS,
#   GATEWAYS ("container:hostport ..." - the host port is where TLS is checked).
#
# Exit: 0 in sync (or synced), 1 failed (rolled back), 2 bad usage,
#       3 installed cert is within WARN_DAYS of expiry and Caddy has nothing newer.
set -euo pipefail

HOST="${HOST:-proxy.proxyhubb.com}"
CADDY_CERT_DIR="${CADDY_CERT_DIR:-/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory}"
DEST="${DEST:-/opt/proxyhubb/certs}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/proxyhubb-certs}"
MIN_DAYS="${MIN_DAYS:-14}"   # refuse to install a cert with less than this left
WARN_DAYS="${WARN_DAYS:-10}" # fail loudly if the installed cert is this close to expiry
read -r -a GATEWAYS <<<"${GATEWAYS:-proxyhubb-edge-gateway-a-1:8443 proxyhubb-edge-gateway-b-1:3129}"

DRY_RUN=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    -h | --help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

log() { echo "edge-tls-sync: $*"; }
die() { log "ERROR: $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "run as root (sudo): Caddy's cert store is not readable otherwise"

exec 9>/run/lock/proxyhubb-edge-tls-sync.lock
flock -n 9 || { log "another run is in progress, skipping"; exit 0; }

src_crt="$CADDY_CERT_DIR/$HOST/$HOST.crt"
src_key="$CADDY_CERT_DIR/$HOST/$HOST.key"
dst_crt="$DEST/server.crt"
dst_key="$DEST/server.key"

[[ -r "$src_crt" && -r "$src_key" ]] || die "Caddy has no cert for $HOST under $CADDY_CERT_DIR"

end_epoch() { # leaf certificate expiry as epoch seconds; $1 = PEM file
  local v
  v="$(openssl x509 -in "$1" -noout -enddate)" || return 1
  date -d "${v#notAfter=}" +%s
}
days_left() { echo $((($(end_epoch "$1") - $(date +%s)) / 86400)); }
served_end_epoch() { # expiry of the leaf a gateway presents on 127.0.0.1:$1
  local v
  v="$(echo | timeout 10 openssl s_client -connect "127.0.0.1:$1" -servername "$HOST" 2>/dev/null |
    openssl x509 -noout -enddate 2>/dev/null)" || return 1
  [[ -n "$v" ]] || return 1
  date -d "${v#notAfter=}" +%s
}

same=0
if [[ -f "$dst_crt" && -f "$dst_key" ]] && cmp -s "$src_crt" "$dst_crt" && cmp -s "$src_key" "$dst_key"; then
  same=1
fi
if [[ "$same" -eq 1 && "$FORCE" -eq 0 ]]; then
  left="$(days_left "$dst_crt")"
  log "up to date: $dst_crt expires in ${left}d"
  if ((left < WARN_DAYS)); then
    log "ALERT: installed cert expires in ${left}d and Caddy has nothing newer - check that Caddy is renewing" >&2
    exit 3
  fi
  exit 0
fi

# --- validate what Caddy holds before touching anything --------------------
openssl x509 -in "$src_crt" -noout -checkend $((MIN_DAYS * 86400)) >/dev/null ||
  die "Caddy's cert for $HOST has under ${MIN_DAYS}d left; refusing to install it (is Caddy renewing?)"
openssl x509 -in "$src_crt" -noout -ext subjectAltName | grep -q "DNS:$HOST" ||
  die "Caddy's cert does not list DNS:$HOST"
[[ "$(openssl x509 -in "$src_crt" -pubkey -noout | sha256sum)" == "$(openssl pkey -in "$src_key" -pubout | sha256sum)" ]] ||
  die "Caddy's key does not match its certificate"
if [[ -f "$dst_crt" && "$FORCE" -eq 0 ]] && (($(end_epoch "$src_crt") <= $(end_epoch "$dst_crt"))); then
  die "Caddy's cert (expires $(openssl x509 -in "$src_crt" -noout -enddate | cut -d= -f2)) is not newer than the installed one; use --force to override"
fi

log "installed: $( [[ -f "$dst_crt" ]] && openssl x509 -in "$dst_crt" -noout -enddate || echo none )"
log "caddy    : $(openssl x509 -in "$src_crt" -noout -enddate) (valid pair for $HOST, ${MIN_DAYS}d+ left)"
if [[ "$DRY_RUN" -eq 1 ]]; then
  log "dry run: would back up to $BACKUP_ROOT/<timestamp>, install, then restart: ${GATEWAYS[*]}"
  exit 0
fi

# --- back up, install atomically ---------------------------------------------
ts="$(date -u +%Y%m%dT%H%M%SZ)"
bk="$BACKUP_ROOT/$ts"
install -d -m 700 "$bk"
had_old=0
if [[ -f "$dst_crt" && -f "$dst_key" ]]; then
  cp -p "$dst_crt" "$dst_key" "$bk/"
  had_old=1
fi
# Keep the modes the gateway containers already read these files with.
mode_crt="$(stat -c %a "$dst_crt" 2>/dev/null || echo 644)"
mode_key="$(stat -c %a "$dst_key" 2>/dev/null || echo 644)"

install_file() { # src dst mode
  local tmp
  tmp="$(mktemp "$2.XXXXXX")"
  cat "$1" >"$tmp"
  chown root:root "$tmp"
  chmod "$3" "$tmp"
  mv -f "$tmp" "$2" # same directory, so the rename is atomic
}

rollback() {
  log "rolling back"
  if [[ "$had_old" -eq 1 ]]; then
    cp -p "$bk/server.crt" "$dst_crt"
    cp -p "$bk/server.key" "$dst_key"
  fi
  for g in "${GATEWAYS[@]}"; do docker restart "${g%%:*}" >/dev/null 2>&1 || true; done
}

mkdir -p "$DEST"
install_file "$src_key" "$dst_key" "$mode_key"
install_file "$src_crt" "$dst_crt" "$mode_crt"
log "installed new cert (backup of the old one: $bk)"

# --- restart gateways one at a time, confirm the new cert is served ----------
want="$(end_epoch "$dst_crt")"
for g in "${GATEWAYS[@]}"; do
  c="${g%%:*}"
  port="${g##*:}"
  log "restarting $c"
  docker restart "$c" >/dev/null || { rollback; die "could not restart $c"; }

  ok=0
  for _ in $(seq 1 40); do # up to ~2 minutes
    st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo missing)"
    if [[ "$st" == "healthy" || "$st" == "running" ]]; then
      got="$(served_end_epoch "$port" || echo 0)"
      if [[ "$got" == "$want" ]]; then ok=1; break; fi
    fi
    sleep 3
  done
  [[ "$ok" -eq 1 ]] || { rollback; die "$c did not come back serving the new cert on :$port"; }
  log "$c healthy and serving the new cert on :$port"
done

log "done: edge gateways now serve a cert expiring in $(days_left "$dst_crt")d"
