#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
export ALLOW_EMERGENCY_WEB_BUILD=1
export WEB_TAR=/tmp/wallet-iso-fix.tar.gz
bash scripts/gcp-deploy-web-emergency-build.sh
echo WALLET_ISO_FIX_DONE
