package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestOpenAPISpecRoutes_RedirectToDocs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	RegisterOpenAPISpecRoutes(r)

	for _, path := range []string{"/openapi.json", "/openapi.yaml"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusFound {
			t.Fatalf("GET %s: expected 302, got %d", path, w.Code)
		}
		if loc := w.Header().Get("Location"); loc != defaultOpenAPISpecURL {
			t.Fatalf("GET %s: expected Location %q, got %q", path, defaultOpenAPISpecURL, loc)
		}
	}
}

func TestOpenAPISpecRoutes_EnvOverride(t *testing.T) {
	t.Setenv("PROXYHUB_OPENAPI_URL", "https://example.com/spec.yaml")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	RegisterOpenAPISpecRoutes(r)

	req := httptest.NewRequest(http.MethodGet, "/openapi.json", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if loc := w.Header().Get("Location"); loc != "https://example.com/spec.yaml" {
		t.Fatalf("expected env override Location, got %q", loc)
	}
}
