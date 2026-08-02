package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func ctxWithRequest(req *http.Request) *gin.Context {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	return c
}

// FE-01 support: browsers cannot set headers on WebSocket handshakes, so the
// realtime client passes ?token=. That must ONLY be honored on genuine upgrade
// requests — never on regular API calls (query strings get logged).
func TestAuthTokenFromRequestWebSocketQueryToken(t *testing.T) {
	t.Run("authorization header wins", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/ws", nil)
		req.Header.Set("Authorization", "Bearer header-token")
		if got := authTokenFromRequest(ctxWithRequest(req)); got != "header-token" {
			t.Fatalf("expected header token, got %q", got)
		}
	})

	t.Run("cookie accepted", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/ws", nil)
		req.AddCookie(&http.Cookie{Name: "proxyhubb_token", Value: "cookie-token"})
		if got := authTokenFromRequest(ctxWithRequest(req)); got != "cookie-token" {
			t.Fatalf("expected cookie token, got %q", got)
		}
	})

	t.Run("query token accepted on websocket upgrade", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/ws?token=query-token", nil)
		req.Header.Set("Upgrade", "websocket")
		req.Header.Set("Connection", "Upgrade")
		if got := authTokenFromRequest(ctxWithRequest(req)); got != "query-token" {
			t.Fatalf("expected query token on upgrade, got %q", got)
		}
	})

	t.Run("query token rejected on plain request", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/sessions?token=query-token", nil)
		if got := authTokenFromRequest(ctxWithRequest(req)); got != "" {
			t.Fatalf("query token must be ignored outside upgrades, got %q", got)
		}
	})

	t.Run("query token rejected when upgrade header alone present", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/ws?token=query-token", nil)
		req.Header.Set("Upgrade", "websocket") // missing Connection: upgrade
		if got := authTokenFromRequest(ctxWithRequest(req)); got != "" {
			t.Fatalf("upgrade requires both headers, got %q", got)
		}
	})

	t.Run("empty without credentials", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/sessions", nil)
		if got := authTokenFromRequest(ctxWithRequest(req)); got != "" {
			t.Fatalf("expected empty token, got %q", got)
		}
	})
}
