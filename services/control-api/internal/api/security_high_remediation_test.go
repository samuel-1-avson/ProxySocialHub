package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
)

func TestAllowedWebSocketOrigin_Allowlist(t *testing.T) {
	t.Setenv("APP_URL", "https://proxyhubb.com")
	t.Setenv("CORS_ORIGINS", "https://www.proxyhubb.com")
	t.Setenv("ENVIRONMENT", "production")

	req := httptest.NewRequest(http.MethodGet, "/v1/ws", nil)
	req.Header.Set("Origin", "https://evil.example")
	if allowedWebSocketOrigin(req) {
		t.Fatal("expected evil origin rejected")
	}

	req.Header.Set("Origin", "https://proxyhubb.com")
	if !allowedWebSocketOrigin(req) {
		t.Fatal("expected APP_URL origin allowed")
	}

	req.Header.Set("Origin", "https://www.proxyhubb.com")
	if !allowedWebSocketOrigin(req) {
		t.Fatal("expected CORS_ORIGINS origin allowed")
	}

	req.Header.Del("Origin")
	if !allowedWebSocketOrigin(req) {
		t.Fatal("expected missing Origin allowed for non-browser clients")
	}
}

func TestAllowedWebSocketOrigin_FailClosedInProd(t *testing.T) {
	os.Unsetenv("APP_URL")
	os.Unsetenv("CORS_ORIGINS")
	t.Setenv("ENVIRONMENT", "production")

	req := httptest.NewRequest(http.MethodGet, "/v1/ws", nil)
	req.Header.Set("Origin", "https://proxyhubb.com")
	if allowedWebSocketOrigin(req) {
		t.Fatal("expected fail-closed when allowlist empty in production")
	}
}

func TestBulkEndpointPasswordStableAndNotUUIDDerived(t *testing.T) {
	t.Setenv("BULK_ENDPOINT_HMAC_SECRET", "unit-test-secret")
	id := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	a := bulkEndpointPassword(id, 1)
	b := bulkEndpointPassword(id, 1)
	c := bulkEndpointPassword(id, 2)
	if a != b {
		t.Fatal("password should be stable for same pool/index")
	}
	if a == c {
		t.Fatal("different indexes must differ")
	}
	legacy := id.String() + "-proxy-001"
	if a == legacy {
		t.Fatal("must not use legacy UUID password formula")
	}
}

func TestParseAllowedBulkScopes(t *testing.T) {
	got, err := parseAllowedBulkScopes("")
	if err != nil || len(got) != 2 {
		t.Fatalf("default scopes: %v %v", got, err)
	}
	if _, err := parseAllowedBulkScopes("admin"); err == nil {
		t.Fatal("expected admin scope rejected")
	}
	got, err = parseAllowedBulkScopes("proxy:read")
	if err != nil || len(got) != 1 || got[0] != "proxy:read" {
		t.Fatalf("read-only: %v %v", got, err)
	}
}
