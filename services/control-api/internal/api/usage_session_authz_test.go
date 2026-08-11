package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestGetSessionUsageRequiresAuth(t *testing.T) {
	r := setupTestRouter()
	RegisterUsageRoutes(r.Group("/v1"))

	req := httptest.NewRequest(http.MethodGet, "/v1/usage/session/pool-abc-001", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without user, got %d", w.Code)
	}
}

func TestGetSessionUsageDeniesUnknownSession(t *testing.T) {
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("userID", "11111111-1111-1111-1111-111111111111")
		c.Next()
	})
	RegisterUsageRoutes(r.Group("/v1"))

	req := httptest.NewRequest(http.MethodGet, "/v1/usage/session/does-not-exist", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown session, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestBulkEndpointHMACSecretFailClosedOutsideDev(t *testing.T) {
	t.Setenv("BULK_ENDPOINT_HMAC_SECRET", "")
	t.Setenv("JWT_SECRET", "")
	t.Setenv("APP_ENV", "staging")

	if _, err := bulkEndpointHMACSecret(); err == nil {
		t.Fatal("expected error when secrets unset in staging")
	}

	t.Setenv("APP_ENV", "development")
	secret, err := bulkEndpointHMACSecret()
	if err != nil {
		t.Fatalf("dev fallback should work: %v", err)
	}
	if secret == "" {
		t.Fatal("expected non-empty dev secret")
	}

	t.Setenv("APP_ENV", "production")
	t.Setenv("BULK_ENDPOINT_HMAC_SECRET", "prod-bulk-secret")
	secret, err = bulkEndpointHMACSecret()
	if err != nil {
		t.Fatalf("explicit secret should work: %v", err)
	}
	if secret != "prod-bulk-secret" {
		t.Fatalf("got %q", secret)
	}
}
