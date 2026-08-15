#!/bin/bash
set -euo pipefail
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "SELECT id::text, status, expires_at, created_at FROM sessions WHERE id='765cc39d-9b13-4036-9d41-7c4f6c6df5a4';"
sudo docker logs --since=3h proxyhubb-control-api-1 2>&1 | grep -iE 'SessionReaper|Ghost detected|765cc39d' | tail -30
