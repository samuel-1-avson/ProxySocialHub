#!/usr/bin/env bash
# Initialize deposit vault after program upgrade (run on workstation with Anchor + admin key).
# Usage:
#   HOT=<hot treasury pubkey> ORACLE=<oracle pubkey> ./scripts/init-deposit-vault.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/services/solana-programs/proxyhub"
HOT="${HOT:?set HOT to SOLANA_TREASURY_HOT_ADDRESS}"
ORACLE="${ORACLE:?set ORACLE to oracle withdraw authority pubkey}"
PROGRAM_ID="${SOLANA_PROGRAM_ID:-AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu}"

echo "Deriving deposit_vault PDA for program $PROGRAM_ID ..."
node <<'NODE'
const { PublicKey } = require("@solana/web3.js");
const programId = new PublicKey(process.env.SOLANA_PROGRAM_ID || "AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu");
const [pda] = PublicKey.findProgramAddressSync([Buffer.from("deposit_vault")], programId);
console.log("DEPOSIT_VAULT_PDA=" + pda.toBase58());
NODE

echo "Then:"
echo "  1) anchor build && deploy/upgrade proxyhub with deposit vault ixs"
echo "  2) call initialize_deposit_vault(hot=$HOT, withdraw_authority=$ORACLE) as program admin"
echo "  3) set SOLANA_DEPOSIT_VAULT_ADDRESS=<PDA> on control-api"
echo "  4) PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED=true (UI still false)"
echo "  5) smoke deposit → enable PROXYHUB_DEPOSIT_VAULT_UI=true"
