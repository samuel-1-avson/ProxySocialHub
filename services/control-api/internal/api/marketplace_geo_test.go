package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMarketplaceGeoRoutesRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/v1")
	RegisterMarketplaceGeoRoutes(v1)
	RegisterListingRoutes(v1)

	var hasListingsGeo, hasMarketplaceGeo bool
	for _, route := range r.Routes() {
		switch route.Method + " " + route.Path {
		case http.MethodGet + " /v1/listings/geo":
			hasListingsGeo = true
		case http.MethodGet + " /v1/marketplace/geo":
			hasMarketplaceGeo = true
		}
	}
	if !hasListingsGeo {
		t.Fatal("missing GET /v1/listings/geo route")
	}
	if !hasMarketplaceGeo {
		t.Fatal("missing GET /v1/marketplace/geo route")
	}
}

func TestGetListingRejectsGeoSlug(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: "geo"}}
	getListing(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "Invalid listing ID") {
		t.Fatalf("geo slug should not return invalid UUID error: %s", w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "marketplace/geo") {
		t.Fatalf("expected geo endpoint hint, got %s", w.Body.String())
	}
}

func TestParseBBox(t *testing.T) {
	w, s, e, n, ok := parseBBox("-10,20,30,50")
	if !ok || w != -10 || s != 20 || e != 30 || n != 50 {
		t.Fatalf("expected valid bbox, got ok=%v w=%v s=%v e=%v n=%v", ok, w, s, e, n)
	}
	_, _, _, _, ok = parseBBox("bad")
	if ok {
		t.Fatal("expected invalid bbox")
	}
}
