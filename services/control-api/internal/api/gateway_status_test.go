package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestGatewayStatusUpdates(t *testing.T) {
	now := time.Now()
	off := gatewayStatusUpdates(GatewayStatusUpdateRequest{IsHealthy: false, Status: "offline", Reason: "tunnel_closed"}, now)
	if off["status"] != models.NodeOffline || off["is_healthy"] != false {
		t.Errorf("offline report = %v, want status offline and unhealthy", off)
	}
	if _, stamped := off["last_seen_at"]; stamped {
		t.Error("an offline report must not stamp last_seen_at")
	}
	// Offline wins even if the edge still says healthy.
	if got := gatewayStatusUpdates(GatewayStatusUpdateRequest{IsHealthy: true, Status: " Offline "}, now); got["status"] != models.NodeOffline {
		t.Errorf("status=Offline with is_healthy=true = %v, want offline", got)
	}
	on := gatewayStatusUpdates(GatewayStatusUpdateRequest{IsHealthy: true, Status: "online"}, now)
	if _, ok := on["status"]; ok {
		t.Error("a healthy report must not force the status; heartbeats do that")
	}
	if on["last_seen_at"] != now {
		t.Errorf("healthy report = %v, want last_seen_at stamped", on)
	}
}

func TestGatewayOfflineReportDoesNotRefreshLastSeen(t *testing.T) {
	testutil.SetupTestDB(t)
	owner := testutil.CreateTestUserID(t, "provider")
	node, _ := testutil.CreateTestProviderNode(t, owner)
	earlier := time.Now().Add(-4 * time.Minute).Truncate(time.Second)
	if err := db.DB.Model(&models.ProviderNode{}).Where("id = ?", node.ID).Update("last_seen_at", earlier).Error; err != nil {
		t.Fatal(err)
	}

	r := setupTestRouter()
	r.POST("/nodes/:id/status", updateGatewayNodeStatus)
	r.POST("/nodes/:id/heartbeat", updateGatewayNodeHeartbeat)
	send := func(path string, body any) int {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest("POST", path, bytes.NewBuffer(raw))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}
	load := func() models.ProviderNode {
		var n models.ProviderNode
		if err := db.DB.First(&n, "id = ?", node.ID).Error; err != nil {
			t.Fatal(err)
		}
		return n
	}

	if code := send("/nodes/"+node.ID.String()+"/status", map[string]any{"is_healthy": false, "status": "offline", "reason": "tunnel_closed"}); code != http.StatusOK {
		t.Fatalf("status report = %d", code)
	}
	n := load()
	if n.Status != models.NodeOffline || n.IsHealthy {
		t.Errorf("after tunnel closed: status=%q healthy=%v, want offline and unhealthy", n.Status, n.IsHealthy)
	}
	if n.LastSeenAt == nil || !n.LastSeenAt.Truncate(time.Second).Equal(earlier) {
		t.Errorf("last_seen_at = %v, want it unchanged at %v", n.LastSeenAt, earlier)
	}

	// An unhealthy heartbeat does not count as a sign of life either.
	if code := send("/nodes/"+node.ID.String()+"/heartbeat", map[string]any{"is_healthy": false}); code != http.StatusOK {
		t.Fatalf("heartbeat = %d", code)
	}
	if n = load(); n.LastSeenAt == nil || !n.LastSeenAt.Truncate(time.Second).Equal(earlier) {
		t.Errorf("after unhealthy heartbeat last_seen_at = %v, want unchanged", n.LastSeenAt)
	}
}
