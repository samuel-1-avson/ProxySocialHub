#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
echo "auth_wired=$(grep -c ProcessReferralSignup services/control-api/internal/api/auth.go || true)"
echo "msg_batch=$(grep -c 'DISTINCT ON' services/control-api/internal/api/messaging.go || true)"
echo "nav_inbox=$(grep -c Inbox apps/web/src/lib/navigation/nav.ts || true)"
echo "--- community nav items ---"
grep -E 'navItem\("community|explorerLeaderboard' apps/web/src/lib/navigation/nav.ts | sed 's/^[[:space:]]*//'
sudo docker ps --filter name=proxyhubb-web-1 --format '{{.Names}} {{.Status}} {{.Image}}'
sudo docker ps --filter name=proxyhubb-control-api --format '{{.Names}} {{.Status}} {{.Image}}'
