package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestCreateProviderToken_AutoRotation(t *testing.T) {
	// Initialize token hashing mock for tests
	models.TokenHashFn = func(raw string) string {
		return raw
	}

	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_tokens")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("token-rotation"), "provider")

	r := setupTestRouter()
	v1 := r.Group("/")
	v1.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID) // uuid.UUID
		c.Set("role", "provider")
	})
	RegisterProviderTokenRoutes(v1)

	t.Run("default expiration when no value provided", func(t *testing.T) {
		body, _ := json.Marshal(map[string]interface{}{
			"name": "default-token",
		})
		req := httptest.NewRequest(http.MethodPost, "/provider/tokens", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d %s", rec.Code, rec.Body.String())
		}

		var resp TokenResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}

		if resp.ExpiresAt == nil {
			t.Fatal("expected ExpiresAt to be set")
		}

		// Expected default is 30 days
		diff := resp.ExpiresAt.Sub(time.Now())
		days := int(diff.Hours() / 24)
		if days < 28 || days > 30 {
			t.Errorf("expected default expiration around 30 days, got %d days", days)
		}
	})

	t.Run("capping expiration to max of 90 days", func(t *testing.T) {
		body, _ := json.Marshal(map[string]interface{}{
			"name":       "long-token",
			"expires_in": 180, // Request 180 days
		})
		req := httptest.NewRequest(http.MethodPost, "/provider/tokens", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d %s", rec.Code, rec.Body.String())
		}

		var resp TokenResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}

		if resp.ExpiresAt == nil {
			t.Fatal("expected ExpiresAt to be set")
		}

		// Expected cap is 90 days
		diff := resp.ExpiresAt.Sub(time.Now())
		days := int(diff.Hours() / 24)
		if days < 88 || days > 90 {
			t.Errorf("expected capped expiration around 90 days, got %d days", days)
		}
	})
}
