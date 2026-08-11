package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// Admin batch payout routes must mount under /payouts (not /admin/payouts)
// and must not use the deprecated AuthMiddleware that always 500s.

func TestAdminPayoutRoutesMountedAtPayouts(t *testing.T) {
	r := setupTestRouter()
	admin := r.Group("/v1/admin")
	admin.Use(func(c *gin.Context) {
		c.Set("userRole", "admin")
		c.Next()
	})
	RegisterAdminPayoutRoutes(admin)

	// Wrong legacy path must 404.
	req := httptest.NewRequest(http.MethodGet, "/v1/admin/admin/payouts/queue", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("legacy double-/admin path should 404, got %d", w.Code)
	}

	// Canonical path is registered (handler may 503 without processor — not 404/500-from-AuthMiddleware).
	req = httptest.NewRequest(http.MethodGet, "/v1/admin/payouts/queue", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code == http.StatusNotFound {
		t.Fatal("expected /v1/admin/payouts/queue to be registered")
	}
	if w.Code == http.StatusInternalServerError && w.Body.String() == `{"error":"Legacy auth middleware called"}` {
		t.Fatal("deprecated AuthMiddleware must not wrap admin payout routes")
	}
}
