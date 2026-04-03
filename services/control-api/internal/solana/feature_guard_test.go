package solana

import (
	"context"
	"testing"

	sol "github.com/gagliardetto/solana-go"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

func TestGetGovernanceExecutionCapabilityReportOracleUnavailable(t *testing.T) {
	originalOracle := globalOracleClient
	globalOracleClient = nil
	t.Cleanup(func() {
		globalOracleClient = originalOracle
	})

	report := GetGovernanceExecutionCapabilityReport(context.Background())

	if report.Feature != "governance_execution" {
		t.Fatalf("expected feature governance_execution, got %q", report.Feature)
	}
	if report.OracleConfigured {
		t.Fatal("expected oracle to be reported as unavailable")
	}
	if report.Ready {
		t.Fatal("expected report to be not ready when oracle is unavailable")
	}
	if report.Status != "oracle_unavailable" {
		t.Fatalf("expected status oracle_unavailable, got %q", report.Status)
	}
	if len(report.RequiredInstructions) != 3 {
		t.Fatalf("expected 3 required instructions, got %d", len(report.RequiredInstructions))
	}
}

func TestGetGovernanceExecutionCapabilityReportReadyWithCompiledFallbackWithoutIDLCached(t *testing.T) {
	originalOracle := globalOracleClient
	originalRedis := redisClient.Client

	globalOracleClient = &OracleClient{programID: sol.PublicKey{1}}
	redisClient.Client = nil

	t.Cleanup(func() {
		globalOracleClient = originalOracle
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
