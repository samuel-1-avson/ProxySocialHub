package solana

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

func TestGetGovernanceExecutionCapabilityReportOracleUnavailable(t *testing.T) {
	originalOracle := globalOracleClient.Load()
	globalOracleClient.Store(nil)
	t.Cleanup(func() {
		globalOracleClient.Store(originalOracle)
	})

	report := GetGovernanceExecutionCapabilityReport(context.Background())

	if report.Feature != "governance_execution" {
		t.Fatalf("expected feature governance_execution, got %q", report.Feature)
	}
	if report.OracleConfigured {
		t.Fatal("expected oracle to be reported as unavailable")
	}
	if report.Ready {
		t.Fatal("expected report to not be ready when oracle is unavailable")
	}
	if report.Status != "oracle_unavailable" {
		t.Fatalf("expected status oracle_unavailable, got %q", report.Status)
	}
	if len(report.RequiredInstructions) != 3 {
		t.Fatalf("expected 3 required instructions, got %d", len(report.RequiredInstructions))
	}
}

func TestGetGovernanceExecutionCapabilityReportReadyWithCompiledFallbackWithoutIDLCached(t *testing.T) {
	originalOracle := globalOracleClient.Load()
	originalRedis := redisClient.Client

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"jsonrpc": "2.0",
			"result": {
				"context": {"slot": 1},
				"value": {
					"data": ["", "base64"],
					"executable": true,
					"lamports": 1000000000,
					"owner": "BPFLoaderUpgradeab1e11111111111111111111111",
					"rentEpoch": 0
				}
			},
			"id": 1
		}`))
	}))
	defer server.Close()

	rpcClient := rpc.New(server.URL)
	globalOracleClient.Store(&OracleClient{
		programID:  sol.PublicKey{1},
		rpcClients: []*rpc.Client{rpcClient},
	})
	redisClient.Client = nil

	t.Cleanup(func() {
		globalOracleClient.Store(originalOracle)
		redisClient.Client = originalRedis
	})

	report := GetGovernanceExecutionCapabilityReport(context.Background())

	if !report.OracleConfigured {
		t.Fatal("expected oracle to be configured")
	}
	if report.ProgramID == "" {
		t.Fatal("expected non-empty program id")
	}
	if report.IDLCached {
		t.Fatal("expected idl_cached=false when redis cache is unavailable")
	}
	if report.IDLSource != "compiled_allowlist" {
		t.Fatalf("expected compiled_allowlist source, got %q", report.IDLSource)
	}
	if !report.Ready {
		t.Fatal("expected report to be ready when compiled fallback covers required instructions")
	}
	if report.Status != "ready" {
		t.Fatalf("expected status ready, got %q", report.Status)
	}
}
