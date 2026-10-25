package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/crypto"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	goredis "github.com/redis/go-redis/v9"
)

const adminTestSecret = "admin-test-secret-admin-test-secret-12345"

func adminRouter(secret string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{}
	cfg.Admin.JWTSecret = secret
	r := gin.New()
	r.Use(AdminAuthMiddleware(cfg))
	r.GET("/admin/me", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"jti": c.GetString("adminJTI")}) })
	return r
}

func callAdmin(r *gin.Engine, token string) int {
	req := httptest.NewRequest(http.MethodGet, "/admin/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code
}

func useMiniredisForAdmin(t *testing.T) {
	t.Helper()
	mr := miniredis.RunT(t)
	prev := redisClient.Client
	redisClient.Client = goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		_ = redisClient.Client.Close()
		redisClient.Client = prev
	})
}

// BE-HIGH-04: with no ADMIN_JWT_SECRET, a token signed with an empty key validated, so anyone
// could mint an admin token.
func TestAdminAuthMiddleware_RefusesWhenNoSecretIsConfigured(t *testing.T) {
	forged, err := jwt.NewWithClaims(jwt.SigningMethodHS256, crypto.CustomClaims{
		UserID: uuid.NewString(),
		Role:   "superadmin",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}).SignedString([]byte(""))
	if err != nil {
		t.Skipf("jwt library refuses an empty signing key: %v", err)
	}

	if got := callAdmin(adminRouter(""), forged); got == http.StatusOK {
		t.Fatal("a token signed with an empty key was accepted as an admin session")
	}
	if got := callAdmin(adminRouter("   "), forged); got == http.StatusOK {
		t.Fatal("a whitespace-only secret must not authenticate anyone")
	}
}

func TestAdminAuthMiddleware_HonoursLogoutAndKeepsOtherSessions(t *testing.T) {
	useMiniredisForAdmin(t)
	r := adminRouter(adminTestSecret)
	adminID := uuid.New()

	mint := func(jti string) string {
		tok, err := crypto.GenerateTokenWithID(adminID, "admin", "ops", "", adminTestSecret, time.Hour, jti)
		if err != nil {
			t.Fatal(err)
		}
		return tok
	}
	first, second := mint("session-a"), mint("session-b")

	if got := callAdmin(r, first); got != http.StatusOK {
		t.Fatalf("valid admin session: %d, want 200", got)
	}

	if err := redisClient.BlockAdminSession("session-a", time.Hour); err != nil {
		t.Fatal(err)
	}
	if got := callAdmin(r, first); got != http.StatusUnauthorized {
		t.Fatalf("revoked admin session: %d, want 401", got)
	}
	if got := callAdmin(r, second); got != http.StatusOK {
		t.Fatalf("a different session of the same admin: %d, want 200", got)
	}
}

func TestAdminAuthMiddleware_RejectsUserTokensAndWrongSecret(t *testing.T) {
	r := adminRouter(adminTestSecret)

	user, _ := crypto.GenerateToken(uuid.New(), "buyer", "", "", adminTestSecret, time.Hour)
	if got := callAdmin(r, user); got != http.StatusForbidden {
		t.Fatalf("non-admin role: %d, want 403", got)
	}
	other, _ := crypto.GenerateToken(uuid.New(), "admin", "", "", "some-other-secret-some-other-secret-1", time.Hour)
	if got := callAdmin(r, other); got != http.StatusUnauthorized {
		t.Fatalf("token signed with another secret: %d, want 401", got)
	}
}
