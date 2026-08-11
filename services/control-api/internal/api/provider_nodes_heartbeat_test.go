package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestNodeHeartbeatRestoresSoftDeletedNode(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")
	gin.SetMode(gin.TestMode)

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("hb-restore"), "provider")

	node := models.ProviderNode{
		ID:     uuid.New(),
		UserID: user.ID,
		Name:   "soft-deleted-node",
		Status: models.NodeOffline,
	}
	if err := db.DB.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	if err := db.DB.Delete(&node).Error; err != nil {
		t.Fatalf("soft-delete node: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID)
		c.Next()
	})
	r.POST("/provider/nodes/:id/heartbeat", nodeHeartbeat)

	body, _ := json.Marshal(map[string]interface{}{
		"latency_ms":         12,
		"active_connections": 1,
		"uptime_percent":     99.0,
	})
	req := httptest.NewRequest(http.MethodPost, "/provider/nodes/"+node.ID.String()+"/heartbeat", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("heartbeat status=%d body=%s", w.Code, w.Body.String())
	}

	var restored models.ProviderNode
	if err := db.DB.Where("id = ?", node.ID).First(&restored).Error; err != nil {
		t.Fatalf("expected restored node visible: %v", err)
	}
	if restored.DeletedAt.Valid {
		t.Fatalf("expected deleted_at cleared, got %+v", restored.DeletedAt)
	}
	if restored.Status != models.NodeOnline {
		t.Fatalf("expected online, got %s", restored.Status)
	}
}

func TestNodeHeartbeatSuggestsActiveNodeWhenMissing(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")
	gin.SetMode(gin.TestMode)

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("hb-suggest"), "provider")
	active := models.ProviderNode{
		ID:     uuid.New(),
		UserID: user.ID,
		Name:   "active-node",
		Status: models.NodeOffline,
	}
	if err := db.DB.Create(&active).Error; err != nil {
		t.Fatalf("create active node: %v", err)
	}
	_ = db.DB.Model(&active).Update("last_seen_at", time.Now())

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID)
		c.Next()
	})
	r.POST("/provider/nodes/:id/heartbeat", nodeHeartbeat)

	missing := uuid.New()
	req := httptest.NewRequest(http.MethodPost, "/provider/nodes/"+missing.String()+"/heartbeat", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload["suggested_node_id"] != active.ID.String() {
		t.Fatalf("suggested_node_id=%v want %s", payload["suggested_node_id"], active.ID)
	}
}
