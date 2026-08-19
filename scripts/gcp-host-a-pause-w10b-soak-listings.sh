#!/usr/bin/env bash
set -euo pipefail
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 -c \
  "update proxy_listings set status='deleted', updated_at=now() where title like 'SOAK W10B listing sync%' and status <> 'deleted';"
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc \
  "select status, count(*) from proxy_listings where seller_id='b77e84c9-0e85-4f23-afc0-581cd561c216' group by status order by 1;"
