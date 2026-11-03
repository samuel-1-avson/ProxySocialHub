package worker

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestRunHeartbeatCheckMarksSilentNodesOffline(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "nodes", "provider_nodes", "users")
	owner := testutil.CreateTestUserID(t, "provider")

	fresh, _ := testutil.CreateTestProviderNode(t, owner)
	silent, _ := testutil.CreateTestProviderNode(t, owner)
	neverSeen, _ := testutil.CreateTestProviderNode(t, owner)
	maintenance, _ := testutil.CreateTestProviderNode(t, owner)

	old := time.Now().Add(-2 * providerNodeStaleAfter())
	set := func(id uuid.UUID, fields map[string]interface{}) {
		t.Helper()
		if err := db.DB.Model(&models.ProviderNode{}).Where("id = ?", id).Updates(fields).Error; err != nil {
			t.Fatalf("update node: %v", err)
		}
	}
	set(silent.ID, map[string]interface{}{"last_seen_at": old})
	// Restored from soft delete as online, no heartbeat yet.
	if err := db.DB.Model(&models.ProviderNode{}).Where("id = ?", neverSeen.ID).
		Update("last_seen_at", gorm.Expr("NULL")).Error; err != nil {
		t.Fatalf("clear last_seen_at: %v", err)
	}
	set(maintenance.ID, map[string]interface{}{"status": models.NodeMaintenance, "last_seen_at": old})

	runHeartbeatCheck()

	status := func(id uuid.UUID) (models.NodeStatus, bool) {
		t.Helper()
		var n models.ProviderNode
		if err := db.DB.First(&n, "id = ?", id).Error; err != nil {
			t.Fatalf("load node: %v", err)
		}
		return n.Status, n.IsHealthy
	}
	if s, _ := status(fresh.ID); s != models.NodeOnline {
		t.Errorf("recently seen node = %q, want online", s)
	}
	if s, healthy := status(silent.ID); s != models.NodeOffline || healthy {
		t.Errorf("silent node = %q healthy=%v, want offline and unhealthy", s, healthy)
	}
	if s, _ := status(neverSeen.ID); s != models.NodeOffline {
		t.Errorf("online node with no last_seen_at = %q, want offline", s)
	}
	if s, _ := status(maintenance.ID); s != models.NodeMaintenance {
		t.Errorf("maintenance node = %q, want it left alone", s)
	}
}
