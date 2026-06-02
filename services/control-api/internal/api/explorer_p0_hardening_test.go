package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestEnforceExplorerPublicSessionsDisabledByDefault(t *testing.T) {
	t.Setenv("EXPLORER_PUBLIC_SESSIONS_ENABLED", "")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/sessions", enforceExplorerPublicSessions(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodGet, "/sessions", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when sessions disabled, got %d", w.Code)
	}
}

func TestEnforceExplorerPublicEarningsDisabledByDefault(t *testing.T) {
	t.Setenv("EXPLORER_PUBLIC_EARNINGS_ENABLED", "")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/earnings", enforceExplorerPublicEarnings(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodGet, "/earnings", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when earnings disabled, got %d", w.Code)
	}
}

func TestEnforceExplorerPublicEarningsEnabled(t *testing.T) {
	t.Setenv("EXPLORER_PUBLIC_EARNINGS_ENABLED", "true")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/earnings", enforceExplorerPublicEarnings(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodGet, "/earnings", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 when earnings enabled, got %d", w.Code)
	}
}

func TestEnforceExplorerPublicSessionsEnabled(t *testing.T) {
	t.Setenv("EXPLORER_PUBLIC_SESSIONS_ENABLED", "true")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/sessions", enforceExplorerPublicSessions(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodGet, "/sessions", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 when sessions enabled, got %d", w.Code)
	}
}
