package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestGetExplorerNodesGeo_AppliesMapCoords(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "explorer_nodes")
	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("geo-consent"), "provider")
	if err := db.DB.Model(provider).Update("map_visible", false).Error; err != nil {
		t.Fatal(err)
	}

	node := models.ExplorerNode{
		NodeID:         "geo-node-gh",
		ProviderUserID: provider.ID.String(),
		Latitude:       0,
		Longitude:      0,
		IsActive:       true,
		Country:        "GH",
		Region:         "west-africa",
		City:           "Accra",
		UptimePercent:  99,
	}
	if err := db.DB.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/explorer/nodes/geo", getExplorerNodesGeo)

	req := httptest.NewRequest(http.MethodGet, "/explorer/nodes/geo", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp NodeGeoResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Nodes) != 0 {
		t.Fatal("node visible before consent")
	}
	if err := db.DB.Model(provider).Update("map_visible", true).Error; err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/explorer/nodes/geo", nil))
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(resp.Nodes))
	}
	p := resp.Nodes[0]
	if p.GeoSource != "country_centroid" {
		t.Fatalf("expected country_centroid, got %q", p.GeoSource)
	}
	if p.Geo == nil || p.Geo.Source != "country_centroid" {
		t.Fatalf("expected geo metadata, got %#v", p.Geo)
	}
	if p.Latitude == 0 && p.Longitude == 0 {
		t.Fatal("expected resolved non-zero coordinates")
	}
	if p.NodeID == node.NodeID || p.City != "" || p.Region != "" || p.ISP != "" || p.ActiveSessions != 0 {
		t.Fatal("private node metadata disclosed", p)
	}
}
