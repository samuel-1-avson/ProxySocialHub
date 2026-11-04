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

func putNodeUpdate(userID, nodeID uuid.UUID, body string) *httptest.ResponseRecorder {
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})
	r.PUT("/provider/nodes/:id", updateNode)
	req := httptest.NewRequest(http.MethodPut, "/provider/nodes/"+nodeID.String(), bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func createUpdateNode(t *testing.T, userID uuid.UUID) models.ProviderNode {
	t.Helper()
	node := models.ProviderNode{
		ID:        uuid.New(),
		UserID:    userID,
		Name:      "upd-node",
		IPAddress: "154.161.87.159",
		Country:   "GH",
		City:      "Kumasi",
		Region:    "Unknown",
		Status:    models.NodeOnline,
	}
	if err := db.DB.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	return node
}

// Saving just the name (what the web form does when the location is
// unchanged) must not erase the IP or claim the location for the owner.
func TestUpdateNodeNameOnlyKeepsIPAndLocation(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")
	gin.SetMode(gin.TestMode)

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("upd-name"), "provider")
	node := createUpdateNode(t, user.ID)

	w := putNodeUpdate(user.ID, node.ID, `{"name":"Renamed"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	got := reloadNode(t, node.ID)
	if got.Name != "Renamed" || got.IPAddress != "154.161.87.159" || got.Country != "GH" || got.City != "Kumasi" || got.LocationUserSet {
		t.Fatalf("got name=%q ip=%q country=%q city=%q set=%v", got.Name, got.IPAddress, got.Country, got.City, got.LocationUserSet)
	}
}

// A city the owner saves is theirs: marked user-set (so gateway IP geo cannot
// overwrite it) with the old IP-derived region cleared; a typed hub name is
// stored in its canonical form, and a city off the hub list is kept as typed.
func TestUpdateNodeLocationIsOwnerSet(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")
	gin.SetMode(gin.TestMode)

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("upd-loc"), "provider")
	node := createUpdateNode(t, user.ID)

	w := putNodeUpdate(user.ID, node.ID, `{"name":"upd-node","country":"gh","city":"sunyani"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	got := reloadNode(t, node.ID)
	if got.Country != "GH" || got.City != "Sunyani" || got.Region != "" || !got.LocationUserSet || got.IPAddress != "154.161.87.159" {
		t.Fatalf("got country=%q city=%q region=%q set=%v ip=%q", got.Country, got.City, got.Region, got.LocationUserSet, got.IPAddress)
	}

	w = putNodeUpdate(user.ID, node.ID, `{"city":"Obuasi"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	got = reloadNode(t, node.ID)
	if got.Country != "GH" || got.City != "Obuasi" || !got.LocationUserSet {
		t.Fatalf("got country=%q city=%q set=%v", got.Country, got.City, got.LocationUserSet)
	}

	// Clearing both hands the location back to automatic detection.
	w = putNodeUpdate(user.ID, node.ID, `{"country":"","city":""}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	got = reloadNode(t, node.ID)
	if got.Country != "" || got.City != "" || got.LocationUserSet {
		t.Fatalf("got country=%q city=%q set=%v", got.Country, got.City, got.LocationUserSet)
	}
}

func TestUpdateNodeRejectsEmptyName(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")
	gin.SetMode(gin.TestMode)

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("upd-empty"), "provider")
	node := createUpdateNode(t, user.ID)

	if w := putNodeUpdate(user.ID, node.ID, `{"name":"  "}`); w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", w.Code)
	}
}
