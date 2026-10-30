package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func putLocation(userID, nodeID uuid.UUID, body string) *httptest.ResponseRecorder {
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})
	r.PUT("/provider/nodes/:id/location", setNodeLocation)
	req := httptest.NewRequest(http.MethodPut, "/provider/nodes/"+nodeID.String()+"/location", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func createLocationNode(t *testing.T, userID uuid.UUID) models.ProviderNode {
	t.Helper()
	node := models.ProviderNode{
		ID:            uuid.New(),
		UserID:        userID,
		Name:          "loc-node",
		Country:       "GH",
		Region:        "Greater Accra",
		GatewayNodeID: "node_" + userID.String(),
		Status:        models.NodeOnline,
	}
	if err := db.DB.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	return node
}

func reloadNode(t *testing.T, id uuid.UUID) models.ProviderNode {
	t.Helper()
	var n models.ProviderNode
	if err := db.DB.Where("id = ?", id).First(&n).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	return n
}

func TestSetNodeLocationSavesCanonicalCity(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")
	gin.SetMode(gin.TestMode)

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("loc-ok"), "provider")
	node := createLocationNode(t, user.ID)

	w := putLocation(user.ID, node.ID, `{"country":"ghana","city":"cape coast"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	got := reloadNode(t, node.ID)
	if got.Country != "GH" || got.City != "Cape Coast" || got.Region != "" || !got.LocationUserSet {
		t.Fatalf("got country=%q city=%q region=%q set=%v", got.Country, got.City, got.Region, got.LocationUserSet)
	}
}

func TestSetNodeLocationRejectsUnknownCity(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")
	gin.SetMode(gin.TestMode)

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("loc-bad"), "provider")
	node := createLocationNode(t, user.ID)

	w := putLocation(user.ID, node.ID, `{"country":"GH","city":"Atlantis"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if got := reloadNode(t, node.ID); got.LocationUserSet || got.City != "" {
		t.Fatalf("node changed on rejected request: city=%q set=%v", got.City, got.LocationUserSet)
	}
}

func TestSetNodeLocationRejectsOtherUsersNode(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")
	gin.SetMode(gin.TestMode)

	owner := testutil.CreateTestUser(t, testutil.UniqueEmail("loc-owner"), "provider")
	other := testutil.CreateTestUser(t, testutil.UniqueEmail("loc-other"), "provider")
	node := createLocationNode(t, owner.ID)

	w := putLocation(other.ID, node.ID, `{"country":"GH","city":"Cape Coast"}`)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestGatewayUpsertKeepsOwnerChosenCity(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")
	gin.SetMode(gin.TestMode)

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("loc-gw"), "provider")
	node := createLocationNode(t, user.ID)
	if w := putLocation(user.ID, node.ID, `{"country":"GH","city":"Cape Coast"}`); w.Code != http.StatusOK {
		t.Fatalf("set location status=%d body=%s", w.Code, w.Body.String())
	}

	// Private peer IP: trusted gateway geo with no network lookups.
	_, _, err := upsertProviderNodeFromGateway(user.ID, RegisterGatewayNodeRequest{
		ProviderUserID: user.ID.String(),
		NodeID:         node.GatewayNodeID,
		IPAddress:      "10.0.0.5",
		CountryCode:    "GH",
		City:           "Accra",
		Region:         "Greater Accra",
	})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if got := reloadNode(t, node.ID); got.City != "Cape Coast" || got.Region != "" {
		t.Fatalf("gateway overwrote owner location: city=%q region=%q", got.City, got.Region)
	}
}

func TestGatewayUpsertStillSetsCityWhenOwnerHasNot(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")
	gin.SetMode(gin.TestMode)

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("loc-gw-unset"), "provider")
	node := createLocationNode(t, user.ID)

	_, _, err := upsertProviderNodeFromGateway(user.ID, RegisterGatewayNodeRequest{
		ProviderUserID: user.ID.String(),
		NodeID:         node.GatewayNodeID,
		IPAddress:      "10.0.0.5",
		CountryCode:    "GH",
		City:           "Kumasi",
	})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if got := reloadNode(t, node.ID); got.City != "Kumasi" {
		t.Fatalf("expected gateway city on unflagged node, got %q", got.City)
	}
}
