package api

import (
	"encoding/json"
	"testing"

	"github.com/proxyhubb/control-api/internal/models"
)

func TestPublicNodeSummaryOmitsProviderIdentity(t *testing.T) {
	n := models.ExplorerNode{
		NodeID:      "node-1",
		ProviderUserID:   "user-internal",
		ProviderUsername: "internal-user",
		Name:        "edge-1",
		Chain:       "solana",
		Region:      "eu",
		Country:     "DE",
		IsActive:    true,
		IsValidator: false,
	}

	body, err := json.Marshal(publicNodeSummary(n))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]interface{}
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"provider_id", "provider_username", "linked_user_id"} {
		if _, ok := m[key]; ok {
			t.Fatalf("public node summary must not include %q", key)
		}
	}
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
	if string(body) != "" && containsField(body, "linked_user") {
		t.Fatalf("wallet response leaked linked_user: %s", body)
	}
}

func containsField(body []byte, field string) bool {
	var m map[string]interface{}
	if json.Unmarshal(body, &m) != nil {
		return false
	}
	_, ok := m[field]
	return ok
}
