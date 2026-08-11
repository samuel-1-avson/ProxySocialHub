package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// SEC-R1: node health inventory/mutations must not be on the public optional-auth group.

func TestPublicHealthRoutesOmitNodeInventory(t *testing.T) {
	r := setupTestRouter()
	RegisterHealthRoutes(r.Group("/v1"))

	for _, tc := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/v1/health/nodes"},
		{http.MethodGet, "/v1/health/nodes/00000000-0000-0000-0000-000000000001"},
		{http.MethodPost, "/v1/health/nodes/00000000-0000-0000-0000-000000000001/check"},
		{http.MethodPost, "/v1/health/nodes/00000000-0000-0000-0000-000000000001/reactivate"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Fatalf("public health registration must not expose %s %s (got %d)", tc.method, tc.path, w.Code)
		}
	}
}

func TestPublicHealthSystemAndStatsStillRegistered(t *testing.T) {
	r := setupTestRouter()
	RegisterHealthRoutes(r.Group("/v1"))

	// Handlers run (may 503 without deps) — must not 404.
	for _, path := range []string{"/v1/health/system", "/v1/health/stats"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code == http.StatusNotFound {
			t.Fatalf("expected %s to remain registered (got 404)", path)
		}
	}
}

func TestAdminNodeHealthRoutesRequireAdminAuth(t *testing.T) {
	r := setupTestRouter()
	admin := r.Group("/v1/admin")
	admin.Use(func(c *gin.Context) {
		// Simulate AdminAuthMiddleware rejecting missing token.
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Admin authorization required"})
	})
	RegisterAdminNodeHealthRoutes(admin)

	for _, tc := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/v1/admin/health/nodes"},
		{http.MethodGet, "/v1/admin/health/nodes/00000000-0000-0000-0000-000000000001"},
		{http.MethodPost, "/v1/admin/health/nodes/00000000-0000-0000-0000-000000000001/check"},
		{http.MethodPost, "/v1/admin/health/nodes/00000000-0000-0000-0000-000000000001/reactivate"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("admin node health %s %s should require admin auth (got %d)", tc.method, tc.path, w.Code)
		}
	}
}
