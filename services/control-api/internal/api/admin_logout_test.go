package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func routesOf(register func(*gin.RouterGroup)) map[string]bool {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	register(r.Group("/admin"))
	out := map[string]bool{}
	for _, route := range r.Routes() {
		out[route.Method+" "+route.Path] = true
	}
	return out
}

// BE-HIGH-04: /logout was registered without the admin middleware, so it never knew the
// caller's session id and revoked nothing.
func TestAdminLogoutIsNotAPublicRoute(t *testing.T) {
	if routesOf(RegisterAdminAuthRoutes)["POST /admin/logout"] {
		t.Fatal("POST /admin/logout is registered on the unauthenticated admin group")
	}
	if !routesOf(RegisterAdminMeRoute)["POST /admin/logout"] {
		t.Fatal("POST /admin/logout is not registered with the authenticated admin routes")
	}
}

func TestAdminLogoutRevokesTheCallersSession(t *testing.T) {
	testutil.SetupTestRedis(t)
	jti := "admin-session-" + uuid.NewString()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("adminJTI", jti)
		c.Set("adminTokenExp", time.Now().Add(30*time.Minute))
		c.Next()
	})
	r.POST("/admin/logout", adminLogout)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/admin/logout", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("logout: %d %s", w.Code, w.Body.String())
	}
	if !redisClient.IsAdminSessionBlocked(jti) {
		t.Fatal("logout did not revoke the session id")
	}
	if redisClient.IsAdminSessionBlocked("another-session") {
		t.Fatal("logout revoked an unrelated session")
	}
}
