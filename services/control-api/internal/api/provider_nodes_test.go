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

func TestCreateNode_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")

	email := testutil.UniqueEmail("provider")
	user := testutil.CreateTestUser(t, email, "provider")

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID)
		c.Next()
	})
	r.POST("/provider/nodes", createNode)

	body := CreateNodeRequest{
		Name:      "Home Node",
		IPAddress: "192.168.1.100",
		Country:   "US",
		City:      "New York",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/provider/nodes", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("Expected status 201, got %d. Body: %s", w.Code, w.Body.String())
	}

	var node models.ProviderNode
	json.Unmarshal(w.Body.Bytes(), &node)

	if node.Name != "Home Node" {
		t.Errorf("Expected name 'Home Node', got '%s'", node.Name)
	}
	if node.UserID != user.ID {
		t.Errorf("Expected user ID %s, got %s", user.ID, node.UserID)
	}
	if node.Status != models.NodeOffline {
		t.Errorf("Expected status offline, got %s", node.Status)
	}
}

func TestUpdateNode_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")

	email := testutil.UniqueEmail("provider")
	user := testutil.CreateTestUser(t, email, "provider")

	node := models.ProviderNode{
		ID:        uuid.New(),
		UserID:    user.ID,
		Name:      "Old Name",
		IPAddress: "127.0.0.1",
	}
	db.DB.Create(&node)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID)
		c.Next()
	})
	r.PUT("/provider/nodes/:id", updateNode)

	body := CreateNodeRequest{
		Name:      "New Name",
		IPAddress: "10.0.0.1",
		Country:   "CA",
		City:      "Toronto",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("PUT", "/provider/nodes/"+node.ID.String(), bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var updatedNode models.ProviderNode
	db.DB.First(&updatedNode, "id = ?", node.ID)
	if updatedNode.Name != "New Name" {
		t.Errorf("Expected name 'New Name', got '%s'", updatedNode.Name)
	}
	if updatedNode.Country != "CA" {
		t.Errorf("Expected country 'CA', got '%s'", updatedNode.Country)
	}
}

func TestDeleteNode_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")

	email := testutil.UniqueEmail("provider")
	user := testutil.CreateTestUser(t, email, "provider")

	node := models.ProviderNode{
		ID:        uuid.New(),
		UserID:    user.ID,
		Name:      "To Delete",
		IPAddress: "127.0.0.1",
	}
	db.DB.Create(&node)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID)
		c.Next()
	})
	r.DELETE("/provider/nodes/:id", deleteNode)

	req := httptest.NewRequest("DELETE", "/provider/nodes/"+node.ID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var count int64
	db.DB.Model(&models.ProviderNode{}).Where("id = ?", node.ID).Count(&count)
	if count != 0 {
		t.Error("Node should be deleted")
	}
}

func TestUpdateNodeStatus_UpdatesStatus(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes", "nodes", "uptime_checks")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("provider"), "provider")
	pn, mirrorID := testutil.CreateTestProviderNode(t, user.ID)
	if err := db.DB.Model(&models.Node{}).Where("id = ?", mirrorID).Update("is_healthy", false).Error; err != nil {
		t.Fatalf("mark mirror unhealthy: %v", err)
	}

	// UpdateNodeStatus goes through the marketplace service, which writes the nodes
	// mirror (is_healthy, latency_ms) and records an uptime check; provider_nodes
	// status comes from heartbeats, not from here.
	UpdateNodeStatus(mirrorID, true, 50)

	var mirror models.Node
	if err := db.DB.First(&mirror, "id = ?", mirrorID).Error; err != nil {
		t.Fatalf("reload node mirror: %v", err)
	}
	if !mirror.IsHealthy || mirror.LatencyMs != 50 {
		t.Errorf("expected healthy mirror with latency 50, got healthy=%v latency=%d (provider node %s)", mirror.IsHealthy, mirror.LatencyMs, pn.ID)
	}

	var check models.UptimeCheck
	if err := db.DB.Where("node_id = ?", mirrorID).First(&check).Error; err != nil {
		t.Fatalf("expected an uptime check: %v", err)
	}
	if !check.IsUp || check.LatencyMs != 50 {
		t.Errorf("expected uptime check up with latency 50, got up=%v latency=%d", check.IsUp, check.LatencyMs)
	}
}

func TestGetNodeUptime(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes", "uptime_checks")

	email := testutil.UniqueEmail("provider")
	user := testutil.CreateTestUser(t, email, "provider")

	node := models.ProviderNode{
		ID:        uuid.New(),
		UserID:    user.ID,
		Name:      "Metrics Node",
		IPAddress: "127.0.0.1",
	}
	if err := db.DB.Create(&node).Error; err != nil {
		t.Fatalf("Failed to create node: %v", err)
	}

	now := time.Now()
	// Clean up any existing checks? Use CleanupTestData.
	// Create checks with explicit IDs if needed, but DB should handle.
	checks := []models.UptimeCheck{
		{NodeID: node.ID, IsUp: true, LatencyMs: 20, CheckedAt: now.Add(-1 * time.Hour)},
		{NodeID: node.ID, IsUp: true, LatencyMs: 30, CheckedAt: now.Add(-2 * time.Hour)},
		{NodeID: node.ID, IsUp: false, LatencyMs: 0, CheckedAt: now.Add(-3 * time.Hour)},
		{NodeID: node.ID, IsUp: true, LatencyMs: 40, CheckedAt: now.Add(-4 * time.Hour)},
	}
	for _, c := range checks {
		db.DB.Create(&c)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID)
		c.Next()
	})
	r.GET("/provider/nodes/:id/uptime", getNodeUptime)

	req := httptest.NewRequest("GET", "/provider/nodes/"+node.ID.String()+"/uptime", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	uptime, ok := response["uptime_percent"].(float64)
	if !ok {
		t.Errorf("uptime_percent is not float64: %T", response["uptime_percent"])
	} else if uptime != 75.0 {
		t.Errorf("Expected uptime 75.0, got %f", uptime)
	}

	// avg_latency_ms might be float64 or int (if whole number)? JSON unmarshals to float64.
	// But let's be safe.
	// (20+30+40)/3 = 30.
	latency, ok := response["avg_latency_ms"].(float64)
	if !ok {
		t.Errorf("avg_latency_ms is not float64: %T", response["avg_latency_ms"])
	} else if latency != 30.0 {
		t.Errorf("Expected avg latency 30.0, got %f", latency)
	}
}
