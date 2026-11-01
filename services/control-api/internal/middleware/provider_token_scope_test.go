package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/crypto"
)

// BE-HIGH-02: a provider CLI token (or the JWT minted from one) sits in a config file on
// a provider's machine. It must only reach the routes a headless node uses.
func TestProviderTokenPathAllowed(t *testing.T) {
	allowed := []struct{ method, path string }{
		{http.MethodGet, "/v1/provider/nodes"},
		{http.MethodPost, "/v1/provider/nodes"},
		{http.MethodPost, "/v1/provider/nodes/abc/heartbeat"},
		{http.MethodPost, "/v1/provider/lease"},
		{http.MethodPost, "/v1/provider/gateway-token"},
		{http.MethodGet, "/v1/provider/earnings/summary"},
		{http.MethodGet, "/v1/cli/download"},
		{http.MethodGet, "/v1/cli/downloads/latest"},
		{http.MethodGet, "/v1/provider/nodes/"},
	}
	for _, tc := range allowed {
		if !providerTokenPathAllowed(tc.method, tc.path) {
			t.Errorf("%s %s should be allowed for a provider token", tc.method, tc.path)
		}
	}

	blocked := []struct{ method, path string }{
		{http.MethodPost, "/v1/wallet/withdraw/sol"},
		{http.MethodPost, "/v1/wallet/transfer"},
		{http.MethodGet, "/v1/wallet"},
		{http.MethodPost, "/v1/api-keys"},
		{http.MethodPatch, "/v1/api-keys/abc"},
		{http.MethodPost, "/v1/orders"},
		{http.MethodPost, "/v1/sessions"},
		{http.MethodPost, "/v1/provider/claim/confirm"},
		{http.MethodPost, "/v1/provider/tokens"},
		// A leaked node token must not be able to approve new devices: that would let it
		// mint further provider tokens, which POST /v1/provider/tokens already denies.
		{http.MethodGet, "/v1/provider/pair/lookup"},
		{http.MethodPost, "/v1/provider/pair/decision"},
		{http.MethodGet, "/v1/provider/earnings"},
		{http.MethodPost, "/v1/provider/earnings/summary"},
		{http.MethodPost, "/v1/cli/download"},
		{http.MethodGet, "/v1/admin/users"},
		// Node management needs the owner's session: a leaked node token must not
		// rename or delete nodes.
		{http.MethodPut, "/v1/provider/nodes/abc"},
		{http.MethodDelete, "/v1/provider/nodes/abc"},
		{http.MethodPut, "/v1/provider/nodes/abc/location"},
		{http.MethodDelete, "/v1/provider/lease/x"},
		{http.MethodGet, "/v1/provider/gateway-token"},
		{http.MethodGet, "/v1/provider/nodesx"},
		{http.MethodGet, "/v1/provider/lease-other"},
	}
	for _, tc := range blocked {
		if providerTokenPathAllowed(tc.method, tc.path) {
			t.Errorf("%s %s must not be allowed for a provider token", tc.method, tc.path)
		}
	}
}

func scopeRouter(authType string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if authType != "" {
			c.Set("auth_type", authType)
		}
		c.Next()
	})
	r.Use(RestrictProviderToken())
	ok := func(c *gin.Context) { c.Status(http.StatusOK) }
	r.POST("/v1/wallet/withdraw/sol", ok)
	r.POST("/v1/provider/lease", ok)
	return r
}

func TestRestrictProviderToken_BlocksOnlyProviderTokens(t *testing.T) {
	do := func(authType, path string) int {
		w := httptest.NewRecorder()
		scopeRouter(authType).ServeHTTP(w, httptest.NewRequest(http.MethodPost, path, nil))
		return w.Code
	}

	if got := do(AuthTypeProviderToken, "/v1/wallet/withdraw/sol"); got != http.StatusForbidden {
		t.Errorf("provider token on withdraw = %d, want 403", got)
	}
	if got := do(AuthTypeProviderToken, "/v1/provider/lease"); got != http.StatusOK {
		t.Errorf("provider token on lease = %d, want 200", got)
	}
	// Normal sessions and API keys are untouched.
	for _, authType := range []string{"", "api_key", "ws_ticket"} {
		if got := do(authType, "/v1/wallet/withdraw/sol"); got != http.StatusOK {
			t.Errorf("auth_type %q on withdraw = %d, want 200", authType, got)
		}
	}
}

func TestMarkProviderNodeClaims(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tag := func(claims *crypto.CustomClaims) string {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		markProviderNodeClaims(c, claims)
		return c.GetString("auth_type")
	}

	if got := tag(&crypto.CustomClaims{Kind: crypto.TokenKindProviderNode, Role: "provider"}); got != AuthTypeProviderToken {
		t.Errorf("provider-node JWT tagged %q, want %q", got, AuthTypeProviderToken)
	}
	// A provider who signs in normally has the same role but is a full session.
	if got := tag(&crypto.CustomClaims{Role: "provider"}); got != "" {
		t.Errorf("a normal provider-role JWT must not be tagged, got %q", got)
	}
	if got := tag(&crypto.CustomClaims{Kind: crypto.TokenKindExtension}); got != "" {
		t.Errorf("an extension JWT must not be tagged as a provider token, got %q", got)
	}
	if got := tag(nil); got != "" {
		t.Errorf("nil claims tagged %q", got)
	}
}
