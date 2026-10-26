# Runs control-api's Go checks inside golang:1.25 against the throwaway Postgres container
# (see README in NEXT_SESSION_PROMPT.md for creating it). Writes vet.log and go.log to -Out.
#
#   .\run-go-tests.ps1 -Src <repo or git worktree root> -Out <folder> -DbName <existing database>
#   .\run-go-tests.ps1 -Src ... -Out ... -DbName ... -Pkg ./internal/billing/ -Filter SettleLock
#
# Always give each concurrent run its own database; the tests truncate tables.
param(
    [Parameter(Mandatory)] [string]$Src,
    [Parameter(Mandatory)] [string]$Out,
    [Parameter(Mandatory)] [string]$DbName,
    [string]$Pkg = './...',
    [string]$Filter = ''
)
New-Item -ItemType Directory -Force $Out | Out-Null
$run = if ($Filter) { "-run '$Filter'" } else { '' }
$inner = "go vet ./... > /out/vet.log 2>&1; echo VET_EXIT=`$? >> /out/vet.log; " +
    "go test -v -p 1 -count=1 $Pkg $run > /out/go.log 2>&1; echo GO_EXIT=`$? >> /out/go.log; echo DONE >> /out/go.log"
docker run --rm --network phub-test `
    -v "${Src}:/src" -v "${Out}:/out" -v phub-gomod:/go/pkg/mod -v phub-gocache:/root/.cache/go-build `
    -w /src/services/control-api `
    -e "TEST_DATABASE_URL=postgres://postgres:testpw@phub-test-pg:5432/${DbName}?sslmode=disable" `
    -e JWT_SECRET=test-jwt-secret-for-ci-min-32-chars-long `
    -e SESSION_SECRET=test-session-secret-for-ci-min-32-chars `
    -e ENCRYPTION_KEY=test-encryption-key-for-ci-32-chars-xx `
    -e TOKEN_HMAC_SECRET=test-token-hmac-secret-for-ci-32-chars `
    -e EMERGENCY_SOL_PRICE_USD=200 -e GOFLAGS=-buildvcs=false -e CGO_ENABLED=0 `
    golang:1.25 sh -c $inner
