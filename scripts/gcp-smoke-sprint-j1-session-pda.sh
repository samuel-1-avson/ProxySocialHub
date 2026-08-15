#!/usr/bin/env bash
# Sprint J1 happy-path wrapper: prepaid session PDA on gcp-testnet.
# Expect: SPRINT_J1_SESSION_PDA_OK (delegates to Phase 1b smoke).
set -euo pipefail
cd /opt/proxyhubb
export API="${API:-http://127.0.0.1:8080}"
export KEEP_FLAG="${KEEP_FLAG:-1}"
export RPC="${RPC:-https://api.devnet.solana.com}"

# Ensure flag stays true (gcp-testnet default); do not flip off after smoke.
if grep -q '^PROXYHUB_REQUIRE_SESSION_PDA=' .env 2>/dev/null; then
  sed -i 's/^PROXYHUB_REQUIRE_SESSION_PDA=.*/PROXYHUB_REQUIRE_SESSION_PDA=true/' .env
else
  echo 'PROXYHUB_REQUIRE_SESSION_PDA=true' >> .env
fi

sed -i 's/\r$//' scripts/gcp-smoke-session-pda-1b.sh
# Patch API default inside 1b if still 18080
sed -i 's|http://127.0.0.1:18080|http://127.0.0.1:8080|g' scripts/gcp-smoke-session-pda-1b.sh

bash scripts/gcp-smoke-session-pda-1b.sh
echo "SPRINT_J1_SESSION_PDA_OK"
