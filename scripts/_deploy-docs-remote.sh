#!/usr/bin/env bash
# Run on proxyhubb-testnet after uploading docs-site-*.tar.gz to /tmp/
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
TAR="${WEB_TAR:-${DOCS_TAR:?Set DOCS_TAR to uploaded tarball}}"

cd "$PROJECT_DIR"
tmpdir=$(mktemp -d)
tar -xzf "$TAR" -C "$tmpdir"

if [[ -d "$tmpdir/docs" ]]; then
  mkdir -p "$PROJECT_DIR/apps/docs"
  rsync -a --delete --exclude node_modules --exclude .next "$tmpdir/docs/" "$PROJECT_DIR/apps/docs/"
fi
if [[ -f "$tmpdir/gcp-deploy-docs.sh" ]]; then
  cp -a "$tmpdir/gcp-deploy-docs.sh" "$PROJECT_DIR/scripts/gcp-deploy-docs.sh"
  sed -i 's/\r$//' "$PROJECT_DIR/scripts/gcp-deploy-docs.sh"
  chmod +x "$PROJECT_DIR/scripts/gcp-deploy-docs.sh"
fi
if [[ -f "$tmpdir/sync-docs-openapi.sh" ]]; then
  cp -a "$tmpdir/sync-docs-openapi.sh" "$PROJECT_DIR/scripts/sync-docs-openapi.sh"
  sed -i 's/\r$//' "$PROJECT_DIR/scripts/sync-docs-openapi.sh"
  chmod +x "$PROJECT_DIR/scripts/sync-docs-openapi.sh"
fi
if [[ -f "$tmpdir/openapi.yaml" ]]; then
  mkdir -p "$PROJECT_DIR/docs"
  cp -a "$tmpdir/openapi.yaml" "$PROJECT_DIR/docs/openapi.yaml"
fi
if [[ -f "$tmpdir/docker-compose.yml" ]]; then
  cp -a "$tmpdir/docker-compose.yml" "$PROJECT_DIR/docker-compose.yml"
fi
if [[ -f "$tmpdir/docker-compose.gcp-testnet.yml" ]]; then
  cp -a "$tmpdir/docker-compose.gcp-testnet.yml" "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
fi
if [[ -f "$tmpdir/Caddyfile.example" ]]; then
  cp -a "$tmpdir/Caddyfile.example" "$PROJECT_DIR/config/gcp/Caddyfile.example"
fi
rm -rf "$tmpdir"

find "$PROJECT_DIR/apps/docs" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.css' -o -name '*.mdx' -o -name '*.json' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

test -f "$PROJECT_DIR/apps/docs/package.json" || { echo "MISSING apps/docs" >&2; exit 1; }
grep -q 'docs.proxyhubb.com' "$PROJECT_DIR/config/gcp/Caddyfile.example" && echo HAS_CADDY_DOCS || echo WARN_CADDY_EXAMPLE

# Ensure compose defines docs service
if ! grep -qE '^  docs:' "$PROJECT_DIR/docker-compose.yml"; then
  echo "ERROR: docker-compose.yml missing docs service — sync compose from repo" >&2
  exit 1
fi

bash "$PROJECT_DIR/scripts/gcp-deploy-docs.sh"

# Best-effort: patch live Caddyfile if present and missing docs block
if [[ -f /etc/caddy/Caddyfile ]] && ! grep -q 'docs.proxyhubb.com' /etc/caddy/Caddyfile; then
  echo "Appending docs.proxyhubb.com to /etc/caddy/Caddyfile"
  sudo tee -a /etc/caddy/Caddyfile >/dev/null <<'EOF'

docs.proxyhubb.com {
	encode gzip
	reverse_proxy 127.0.0.1:3010
}
EOF
  sudo systemctl reload caddy || sudo caddy reload --config /etc/caddy/Caddyfile || true
fi

echo REMOTE_DOCS_DONE
