package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func postClaimEndpoint(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()
	r := setupTestRouter()
	r.Use(authMiddlewareMock(uuid.New().String(), "provider"))
	RegisterProviderClaimRoutes(&r.RouterGroup)

	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// BE-CRIT-02: the manual claim flow pays from the treasury on top of the other
// payout paths, so it must be off unless explicitly enabled.
func TestProviderClaimEndpointsDisabledByDefault(t *testing.T) {
	t.Setenv("ENABLE_PROVIDER_CLAIM", "")

	for _, path := range []string{"/provider/claim/prepare", "/provider/claim/confirm"} {
		w := postClaimEndpoint(t, path)
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s: expected 503 when disabled, got %d body %s", path, w.Code, w.Body.String())
		}
	}
}

func TestProviderClaimEndpointsReachHandlerWhenEnabled(t *testing.T) {
	t.Setenv("ENABLE_PROVIDER_CLAIM", "true")

	// confirm rejects the empty body with 400 before touching the DB or the oracle,
	// which shows the request got past the gate.
	w := postClaimEndpoint(t, "/provider/claim/confirm")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected handler to run (400 on empty body), got %d body %s", w.Code, w.Body.String())
	}
}
