package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMapTopologyRoutesRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/v1")
	RegisterMapTopologyRoutes(v1)

	var hasMapLinks bool
	for _, route := range r.Routes() {
		if route.Method == http.MethodGet && route.Path == "/v1/map/links" {
			hasMapLinks = true
		}
	}
	if !hasMapLinks {
		t.Fatal("missing GET /v1/map/links route")
	}
}

func TestGetMapLinks_EmptyDB(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/map/links", getMapLinks)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/map/links", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}

	var resp mapLinksResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Meta.TopologyAvailable {
		t.Fatal("expected topology_available false with nil DB")
	}
	if len(resp.Links) != 0 {
		t.Fatalf("expected empty links, got %d", len(resp.Links))
	}
}

func TestParseMapLinksBBox(t *testing.T) {
	box, ok := parseMapLinksBBox("-130,20,-60,60")
	if !ok {
		t.Fatal("expected valid bbox")
	}
	if box.West != -130 || box.South != 20 || box.East != -60 || box.North != 60 {
		t.Fatalf("unexpected box: %+v", box)
	}
	if _, ok := parseMapLinksBBox("bad"); ok {
		t.Fatal("expected invalid bbox")
	}
}
