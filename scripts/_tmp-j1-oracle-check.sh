#!/usr/bin/env bash
set -euo pipefail
ls -la /opt/proxyhubb/infra/oracle* 2>&1 || true
ls -la /opt/proxyhubb/infra/*.json 2>&1 | head -20 || true
sudo docker exec proxyhubb-control-api-1 sh -c 'printenv' | grep -E 'ORACLE|KMS|USE_GCP' | sed 's/=.*/=***/' || true
