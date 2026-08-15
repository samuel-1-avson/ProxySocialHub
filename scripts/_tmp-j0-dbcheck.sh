#!/usr/bin/env bash
set -euo pipefail
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "\dt public.*" | head -60
echo "---"
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -At -c "SELECT to_regclass('public.session_gateway_cache');"
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='users';"
