# Curated commit prep for BC-11 Sprint A + Phase B (DO NOT push until approved)
#
# Safe to include (examples):
#   services/zk-prover/**
#   services/control-api/internal/zk/**
#   services/control-api/internal/billing/zk_aggregator.go
#   services/control-api/internal/solana/zk_batch*.go
#   services/control-api/internal/decentralization/mode*.go
#   services/control-api/internal/api/zk_reputation.go
#   programs/reputation/**
#   docs/ops/BC11_*.md docs/ops/evidence/BC11_* docs/ops/STATUS_*
#   docs/audit/11_*.md docs/audit/02_*.md (if tracked)
#   .gitignore
#   scripts/ops-deploy-bc11*.sh scripts/ops-verify-bc08.sh
#
# NEVER stage:
#   .env .env.* secrets/ *keypair*.json jwt.txt
#   .deploy-stage* *.tar.gz .zk-keys/ params.bin vk.bin pk.bin
#   .tmp-* treasury-keypair.json infra/secrets/
#
# Suggested flow after review:
#   git add -u .gitignore services/zk-prover programs/reputation ...
#   git status   # inspect
#   git commit   # only when asked
#   git push     # only when explicitly asked
