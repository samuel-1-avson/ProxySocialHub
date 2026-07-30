package middleware

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func setupAPIKeyTestDB(t *testing.T) {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	// Avoid AutoMigrate — APIKey uses Postgres jsonb/uuid defaults that sqlite rejects.
	if err := gdb.Exec(`
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  permissions TEXT,
  rate_limit_per_min INTEGER DEFAULT 100,
  last_used_at DATETIME,
  expires_at DATETIME,
  created_at DATETIME,
  revoked_at DATETIME
)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.DB = gdb
	t.Cleanup(func() { db.DB = nil })
}

func seedAPIKey(t *testing.T, plaintext string, userID uuid.UUID, revoked bool) {
	t.Helper()
	sum := sha256.Sum256([]byte(plaintext))
	prefixLen := 12
	if len(plaintext) < prefixLen {
		prefixLen = len(plaintext)
	}
	key := models.APIKey{
		ID:          uuid.New(),
		UserID:      userID,
		Name:        "test",
		KeyHash:     hex.EncodeToString(sum[:]),
		KeyPrefix:   plaintext[:prefixLen],
		Permissions: models.PermissionsList{"proxy:read", "proxy:write"},
		CreatedAt:   time.Now(),
	}
	if revoked {
		now := time.Now()
		key.RevokedAt = &now
	}
	if err := db.DB.Create(&key).Error; err != nil {
		t.Fatalf("seed key: %v", err)
	}
}

func TestRequireAuthOrAPIKey_JWTAlreadySet(t *testing.T) {
	gin.SetMode(gin.TestMode)
	uid := uuid.New()
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", uid)
		c.Next()
	})
	r.GET("/ok", RequireAuthOrAPIKey(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodGet, "/ok", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestRequireAuthOrAPIKey_PhubKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupAPIKeyTestDB(t)
	userID := uuid.New()
	plaintext := "phub_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	seedAPIKey(t, plaintext, userID, false)

	r := gin.New()
	r.GET("/ok", RequireAuthOrAPIKey(), func(c *gin.Context) {
		got, _ := c.Get("user_id")
		c.JSON(http.StatusOK, gin.H{"user_id": got.(uuid.UUID).String()})
	})

	req := httptest.NewRequest(http.MethodGet, "/ok", nil)
	req.Header.Set("X-API-Key", plaintext)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestRequireAuthOrAPIKey_BearerPhub(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupAPIKeyTestDB(t)
	userID := uuid.New()
	plaintext := "phub_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	seedAPIKey(t, plaintext, userID, false)

	r := gin.New()
	r.GET("/ok", RequireAuthOrAPIKey(), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/ok", nil)
	req.Header.Set("Authorization", "Bearer "+plaintext)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestRequireAuthOrAPIKey_PkKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupAPIKeyTestDB(t)
	userID := uuid.New()
	plaintext := "pk_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	seedAPIKey(t, plaintext, userID, false)

	r := gin.New()
	r.GET("/ok", RequireAuthOrAPIKey(), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/ok", nil)
	req.Header.Set("X-API-Key", plaintext)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestRequireAuthOrAPIKey_Missing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/ok", RequireAuthOrAPIKey(), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/ok", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestRequireAuthOrAPIKey_InvalidKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupAPIKeyTestDB(t)

	r := gin.New()
	r.GET("/ok", RequireAuthOrAPIKey(), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/ok", nil)
	req.Header.Set("X-API-Key", "phub_deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestRequireAuthOrAPIKey_RevokedKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupAPIKeyTestDB(t)
	userID := uuid.New()
	plaintext := "phub_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
	seedAPIKey(t, plaintext, userID, true)

	r := gin.New()
	r.GET("/ok", RequireAuthOrAPIKey(), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/ok", nil)
	req.Header.Set("X-API-Key", plaintext)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestExtractAPIKey_IgnoresJWTBearer(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	c.Request.Header.Set("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig")
	if got := extractAPIKey(c); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}
}
