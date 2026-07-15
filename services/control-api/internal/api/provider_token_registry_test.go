package api

import (
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestGetOrCreateNodeID_CreatesProviderNodeNotLegacyRow(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes", "nodes", "provider_node_registrations", "provider_tokens")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("p2-token"), "provider")
	raw, err := models.GenerateRawToken()
	if err != nil {
		t.Fatal(err)
	}
	token := models.ProviderToken{
		ID:       uuid.New(),
		UserID:   user.ID,
		Token:    models.HashToken(raw),
		Name:     "p2-test",
		IsActive: true,
	}
	if err := db.DB.Create(&token).Error; err != nil {
		t.Fatal(err)
	}

	nodeID := getOrCreateNodeID(token)
	if nodeID == uuid.Nil {
		t.Fatal("expected non-nil node id")
	}

	var pn models.ProviderNode
	if err := db.DB.First(&pn, "id = ?", nodeID).Error; err != nil {
		t.Fatalf("expected provider_nodes row: %v", err)
	}
	if pn.UserID != user.ID {
		t.Fatalf("provider node user_id = %s, want %s", pn.UserID, user.ID)
	}

	var legacyCount int64
	if err := db.DB.Model(&models.Node{}).Where("provider_user_id = ?", user.ID).Count(&legacyCount).Error; err != nil {
		t.Fatal(err)
	}
	if legacyCount != 0 {
		t.Fatalf("expected no legacy nodes rows for new token, got %d", legacyCount)
	}

	var reg models.ProviderNodeRegistration
	if err := db.DB.Where("token_id = ?", token.ID).First(&reg).Error; err != nil {
		t.Fatal(err)
	}
	if reg.NodeID != nodeID {
		t.Fatalf("registration node_id = %s, want %s", reg.NodeID, nodeID)
	}
}

func TestGetOrCreateNodeID_ReusesExistingProviderRegistration(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes", "nodes", "provider_node_registrations", "provider_tokens")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("p2-reuse"), "provider")
	pnID := uuid.New()
	pn := models.ProviderNode{
		ID:     pnID,
		UserID: user.ID,
		Name:   "Existing",
		Status: models.NodeOffline,
	}
	if err := db.DB.Create(&pn).Error; err != nil {
		t.Fatal(err)
	}

	raw, _ := models.GenerateRawToken()
	token := models.ProviderToken{
		ID:       uuid.New(),
		UserID:   user.ID,
		Token:    models.HashToken(raw),
		Name:     "reuse",
		IsActive: true,
	}
	if err := db.DB.Create(&token).Error; err != nil {
		t.Fatal(err)
	}
	reg := models.ProviderNodeRegistration{
		UserID:   user.ID,
		TokenID:  token.ID,
		NodeID:   pnID,
		IsActive: true,
	}
	if err := db.DB.Create(&reg).Error; err != nil {
		t.Fatal(err)
	}

	got := getOrCreateNodeID(token)
	if got != pnID {
		t.Fatalf("got %s, want %s", got, pnID)
	}
}
