package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestHasProviderCapabilities(t *testing.T) {
	t.Parallel()
	cases := []struct {
		role string
		want bool
	}{
		{"provider", true},
		{"admin", true},
		{"superadmin", true},
		{"moderator", true},
		{"buyer", false},
		{"user", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := HasProviderCapabilities(tc.role); got != tc.want {
			t.Fatalf("HasProviderCapabilities(%q) = %v, want %v", tc.role, got, tc.want)
		}
	}
}

func TestRequireProviderRole(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("allows provider", func(t *testing.T) {
		r := gin.New()
		r.Use(func(c *gin.Context) {
			c.Set("userRole", "provider")
			c.Next()
		})
		r.Use(RequireProviderRole())
		r.GET("/ok", func(c *gin.Context) { c.Status(http.StatusOK) })

		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/ok", nil))
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", w.Code)
		}
	})

	t.Run("rejects buyer", func(t *testing.T) {
		r := gin.New()
		r.Use(func(c *gin.Context) {
			c.Set("userRole", "buyer")
			c.Next()
		})
		r.Use(RequireProviderRole())
		r.GET("/ok", func(c *gin.Context) { c.Status(http.StatusOK) })

		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/ok", nil))
		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", w.Code)
		}
	})

	t.Run("requires auth context", func(t *testing.T) {
		r := gin.New()
		r.Use(RequireProviderRole())
		r.GET("/ok", func(c *gin.Context) { c.Status(http.StatusOK) })

		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/ok", nil))
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401", w.Code)
		}
	})
}
