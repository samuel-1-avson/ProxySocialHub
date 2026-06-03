package api

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/proxyhubb/control-api/internal/models"
)

func assertJSONKeysAbsent(t *testing.T, body []byte, keys ...string) {
	t.Helper()
	var m map[string]interface{}
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatal(err)
	}
	for _, key := range keys {
		if _, ok := m[key]; ok {
			t.Fatalf("public JSON must not include %q; body=%s", key, body)
		}
	}
}

func TestPublicNodeSummaryOmitsProviderIdentity(t *testing.T) {
	n := models.ExplorerNode{
		NodeID:           "node-1",
		ProviderUserID:   "user-internal",
		ProviderUsername: "internal-user",
		Name:             "edge-1",
		Chain:            "solana",
		Region:           "eu",
		Country:          "DE",
		IsActive:         true,
		IsValidator:      false,
	}

	body, err := json.Marshal(publicNodeSummary(n))
	if err != nil {
		t.Fatal(err)
	}
	assertJSONKeysAbsent(t, body, "provider_id", "provider_username", "linked_user_id")
}

func TestPublicNodeDetailOmitsHotkey(t *testing.T) {
	n := models.ExplorerNode{
		NodeID:      "node-1",
		Name:        "edge-1",
		Chain:       "solana",
		Region:      "eu",
		Country:     "DE",
		IsActive:    true,
		IsValidator: true,
	}
	detail := NodeDetailResponse{
		NodeSummary: publicNodeSummary(n),
		LatencyMs:   12,
		SuccessRate: 99.5,
	}
	body, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	assertJSONKeysAbsent(t, body, "hotkey", "provider_id", "provider_username")
}

func TestExplorerLeaderboardResponseIncludesTrustFields(t *testing.T) {
	body, err := json.Marshal(ExplorerLeaderboardResponse{
		Category:      "uptime",
		Period:        "24h",
		DataSource:    "indexed_nodes",
		PeriodApplied: false,
		Note:          "test note",
	})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]interface{}
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"data_source", "period_applied", "note"} {
		if _, ok := m[key]; !ok {
			t.Fatalf("expected %q in leaderboard JSON: %s", key, body)
		}
	}
}

func TestExplorerMetricsResponseIncludesTPSField(t *testing.T) {
	body, err := json.Marshal(ExplorerMetricsResponse{
		Chain:                    "solana",
		TPS:                      0.42,
		TpsWindowHours:           24,
		DataSource:               "aggregated",
		MetricsAggregatorEnabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]interface{}
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatal(err)
	}
	if _, ok := m["transactions_per_second"]; !ok {
		t.Fatalf("expected transactions_per_second in JSON: %s", body)
	}
	if _, ok := m["metrics_aggregator_enabled"]; !ok {
		t.Fatalf("expected metrics_aggregator_enabled in JSON: %s", body)
	}
	if m["transactions_per_second"].(float64) != 0.42 {
		t.Fatalf("unexpected TPS value: %v", m["transactions_per_second"])
	}
}

func TestTransactionDetailResponseOmitsRawData(t *testing.T) {
	detail := TransactionDetailResponse{
		TxHash:        "abc123",
		Chain:         "solana",
		FromAddress:   "from",
		ToAddress:     "to",
		Amount:        1.5,
		Currency:      "SOL",
		Status:        "confirmed",
		Timestamp:     time.Now().UTC(),
		Confirmations: 32,
	}
	body, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	assertJSONKeysAbsent(t, body, "raw_data")
}

func TestWriterHealthOmitsRPCEndpoint(t *testing.T) {
	rows := buildWriterHealthRows(
		ExplorerDecentralizationWritersResponse{RecentSlotsAnalyzed: 10},
		100,
		[]explorerWriterRollupRow{{WriterID: "w1", LatestSlot: 100, AttestationCount: 5, SlotsCovered: 8}},
		map[string]int64{},
		map[string]explorerWriterIdentityEvidence{
			"w1": {WriterID: "w1", WriterPublicKey: "cHVibGlj"},
		},
	)
	if len(rows) != 1 {
		t.Fatalf("expected 1 writer row, got %d", len(rows))
	}
	if rows[0].RPCEndpoint != "" {
		t.Fatalf("rpc_endpoint must be redacted, got %q", rows[0].RPCEndpoint)
	}
	body, err := json.Marshal(rows[0])
	if err != nil {
		t.Fatal(err)
	}
	assertJSONKeysAbsent(t, body, "rpc_endpoint")
}

func TestProviderEarningSummaryOmitsInternalIDs(t *testing.T) {
	summary := ProviderEarningSummary{
		NodeID:          "node-1",
		ProviderAddress: "So11111111111111111111111111111111111111112",
		SessionCount:    3,
		BandwidthGB:     1.5,
		TotalEarned:     0.42,
		LastPayout:      time.Now().UTC(),
	}
	body, err := json.Marshal(summary)
	if err != nil {
		t.Fatal(err)
	}
	assertJSONKeysAbsent(t, body,
		"provider_user_id", "provider_id", "provider_username", "linked_user_id", "email",
	)
}

func TestExplorerSessionSummaryOmitsUserAndNodeIdentity(t *testing.T) {
	summary := ExplorerSessionSummary{
		SessionID:   "sess-1",
		SessionType: "proxy",
		Status:      "active",
		BytesUsed:   1024,
		StartTime:   time.Now().UTC(),
	}
	body, err := json.Marshal(summary)
	if err != nil {
		t.Fatal(err)
	}
	assertJSONKeysAbsent(t, body,
		"user_id", "provider_id", "node_id", "wallet_address", "ip_address", "proxy_url",
	)
}

func TestWalletDetailsResponseOmitsLinkedUser(t *testing.T) {
	resp := WalletDetailsResponse{
		Address:          "So11111111111111111111111111111111111111112",
		Chain:            "solana",
		TransactionCount: 1,
	}
	body, err := json.Marshal(resp)
	if err != nil {
		t.Fatal(err)
	}
	assertJSONKeysAbsent(t, body, "linked_user_id", "linked_user")
}
