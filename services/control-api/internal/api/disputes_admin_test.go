package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// BE-03 regression: dispute resolution endpoints must live only on the
// admin-JWT group, never on the user-protected group.

func TestDisputeAdminRoutesNotOnUserGroup(t *testing.T) {
	r := setupTestRouter()
	RegisterDisputeRoutes(r.Group("/"))

	for _, path := range []string{
		"/admin/disputes/00000000-0000-0000-0000-000000000000/resolve",
		"/admin/disputes/00000000-0000-0000-0000-000000000000/dismiss",
	} {
		req := httptest.NewRequest(http.MethodPost, path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Fatalf("user-group registration must not expose %s (got %d)", path, w.Code)
		}
	}
}

func TestDisputeAdminRoutesOnAdminGroup(t *testing.T) {
	r := setupTestRouter()
	RegisterAdminDisputeRoutes(r.Group("/admin"))

	for _, path := range []string{
		"/admin/disputes/00000000-0000-0000-0000-000000000000/resolve",
		"/admin/disputes/00000000-0000-0000-0000-000000000000/dismiss",
	} {
		req := httptest.NewRequest(http.MethodPost, path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		// No userRole/auth_type in context → isAdmin false → 403 (not 404).
		if w.Code != http.StatusForbidden {
			t.Fatalf("admin-group %s should require admin role (got %d)", path, w.Code)
		}
	}
}

func TestIsAdminRoleSources(t *testing.T) {
	cases := []struct {
		name     string
		set      map[string]interface{}
		expected int
	}{
		{"userRole admin", map[string]interface{}{"userRole": "admin"}, http.StatusNoContent},
		{"auth_type admin", map[string]interface{}{"auth_type": "admin"}, http.StatusNoContent},
		{"userRole buyer", map[string]interface{}{"userRole": "buyer"}, http.StatusForbidden},
		{"userRole provider", map[string]interface{}{"userRole": "provider"}, http.StatusForbidden},
		{"no role context", map[string]interface{}{}, http.StatusForbidden},
		// The pre-BE-02 bug: middleware sets "userRole", never "role".
		{"legacy role key ignored", map[string]interface{}{"role": "admin"}, http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r2 := setupTestRouter()
			for k, v := range tc.set {
				val := v
				key := k
				r2.Use(func(c *gin.Context) { c.Set(key, val) })
			}
			r2.GET("/check", func(c *gin.Context) {
				if isAdmin(c) {
					c.Status(http.StatusNoContent)
					return
				}
				c.Status(http.StatusForbidden)
			})
			req := httptest.NewRequest(http.MethodGet, "/check", nil)
			w := httptest.NewRecorder()
			r2.ServeHTTP(w, req)
			if w.Code != tc.expected {
				t.Fatalf("expected %d, got %d", tc.expected, w.Code)
			}
		})
	}
}
