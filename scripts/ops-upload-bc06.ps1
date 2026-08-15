# Upload BC-06 sources + cosigner to proxyhubb-testnet and run remote deploy.
$ErrorActionPreference = "Stop"
$Project = "gen-lang-client-0022105784"
$Zone = "us-central1-a"
$Instance = "proxyhubb-testnet"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not (Test-Path "$Root\services\control-api")) {
  $Root = "F:\project\proxyhubb"
}

$stage = Join-Path $env:TEMP "bc06-upload"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Path $stage | Out-Null

$files = @{
  "multisig_oracle.go" = "services\control-api\internal\solana\multisig_oracle.go"
  "mode.go" = "services\control-api\internal\decentralization\mode.go"
  "mode_multisig_settle_test.go" = "services\control-api\internal\decentralization\mode_multisig_settle_test.go"
  "main.go" = "services\control-api\main.go"
  "order.go" = "services\control-api\internal\models\order.go"
  "orders.go" = "services\control-api\internal\api\orders.go"
  "orders_confirm_escrow.go" = "services\control-api\internal\api\orders_confirm_escrow.go"
  "escrow.go" = "services\control-api\internal\api\escrow.go"
  "escrow_settle.go" = "services\control-api\internal\api\escrow_settle.go"
  "escrow_settle_test.go" = "services\control-api\internal\api\escrow_settle_test.go"
  "compensation_outbox.go" = "services\control-api\internal\api\compensation_outbox.go"
  "000142_orders_escrow_multisig.up.sql" = "migrations\000142_orders_escrow_multisig.up.sql"
  "000142_orders_escrow_multisig.down.sql" = "migrations\000142_orders_escrow_multisig.down.sql"
  "docker-compose.yml" = "docker-compose.yml"
  "docker-compose.gcp-testnet.yml" = "docker-compose.gcp-testnet.yml"
  "multisig-cosigner.json" = "secrets\multisig-cosigner.json"
  "ops-deploy-bc06.sh" = "scripts\ops-deploy-bc06.sh"
  "solana.ts" = "apps\web\src\lib\solana.ts"
  "BuyListingModal.tsx" = "apps\web\src\components\BuyListingModal.tsx"
  "marketplace.ts" = "apps\web\src\lib\api\marketplace.ts"
  "proxyhub.json" = "apps\web\src\lib\idl\proxyhub.json"
}

foreach ($kv in $files.GetEnumerator()) {
  $src = Join-Path $Root $kv.Value
  if (-not (Test-Path $src)) { throw "missing $src" }
  Copy-Item $src (Join-Path $stage $kv.Key)
}

gcloud compute ssh $Instance --project $Project --zone $Zone --command "mkdir -p /tmp/bc06"
gcloud compute scp --project $Project --zone $Zone --recurse "$stage\*" "${Instance}:/tmp/bc06/"

gcloud compute ssh $Instance --project $Project --zone $Zone --command "tr -d '\015' </tmp/bc06/ops-deploy-bc06.sh >/tmp/ops-deploy-bc06.sh && chmod +x /tmp/ops-deploy-bc06.sh && sudo bash /tmp/ops-deploy-bc06.sh"

# Web sources (optional rebuild if web is live)
gcloud compute ssh $Instance --project $Project --zone $Zone --command @"
cd /opt/proxyhubb
mkdir -p apps/web/src/lib/idl apps/web/src/components apps/web/src/lib/api
tr -d '\015' </tmp/bc06/solana.ts > apps/web/src/lib/solana.ts
tr -d '\015' </tmp/bc06/BuyListingModal.tsx > apps/web/src/components/BuyListingModal.tsx
tr -d '\015' </tmp/bc06/marketplace.ts > apps/web/src/lib/api/marketplace.ts
tr -d '\015' </tmp/bc06/proxyhub.json > apps/web/src/lib/idl/proxyhub.json
echo WEB_SOURCES_INSTALLED
"@

Write-Host "BC06_UPLOAD_DONE"
