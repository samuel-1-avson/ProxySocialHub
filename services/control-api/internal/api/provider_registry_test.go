package api

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestReconcileProviderNodeRegistry_LinksGatewayRow(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes", "nodes")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("registry"), "provider")
	providerNodeID := uuid.New()
	gatewayID := providerGatewayNodeID(user.ID)

	pn := models.ProviderNode{
		ID:     providerNodeID,
		UserID: user.ID,
		Name:   "Registry Test Node",
		Status: models.NodeOffline,
	}
	if err := db.DB.Create(&pn).Error; err != nil {
		t.Fatal(err)
	}

	gatewayRow := models.Node{
		ID:             uuid.New(),
		UserID:         user.ID,
		ProviderUserID: user.ID,
		GatewayNodeID:  gatewayID,
		CountryCode:    "US",
		LastSeenAt:     time.Now(),
	}
	if err := db.DB.Create(&gatewayRow).Error; err != nil {
		t.Fatal(err)
	}

	reconcileProviderNodeRegistry(user.ID, providerNodeID, gatewayID, 12)

	var linked models.Node
	if err := db.DB.Select("provider_node_id", "gateway_node_id").
		First(&linked, "id = ?", gatewayRow.ID).Error; err != nil {
		t.Fatal(err)
	}
	if linked.ProviderNodeID == nil || *linked.ProviderNodeID != providerNodeID {
		t.Fatalf("expected provider_node_id %s, got %v", providerNodeID, linked.ProviderNodeID)
	}

	var updatedPN models.ProviderNode
	if err := db.DB.Select("gateway_node_id", "status", "avg_latency_ms").
		First(&updatedPN, "id = ?", providerNodeID).Error; err != nil {
		t.Fatal(err)
	}
	if updatedPN.GatewayNodeID != gatewayID {
		t.Fatalf("expected gateway_node_id %q, got %q", gatewayID, updatedPN.GatewayNodeID)
	}
	if updatedPN.Status != models.NodeOnline {
		t.Fatalf("expected online status, got %s", updatedPN.Status)
	}
	if updatedPN.AvgLatencyMs != 12 {
		t.Fatalf("expected latency 12, got %d", updatedPN.AvgLatencyMs)
	}
}
