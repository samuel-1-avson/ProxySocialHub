package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func patchAPIKey(t *testing.T, keyID, userID, role string, body map[string]interface{}) *httptest.ResponseRecorder {
	t.Helper()
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("userID", userID)
		c.Set("userRole", role)
		c.Next()
	})
	r.PATCH("/api-keys/:id", updateAPIKey)
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPatch, "/api-keys/"+keyID, bytes.NewBuffer(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func newTestAPIKey(t *testing.T, role string) (models.User, models.APIKey) {
	t.Helper()
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("apikey-grant"), role)
	key, _, err := models.GenerateAPIKey(user.ID, "grant test", []string{"read"}, 100, nil)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	if err := db.DB.Create(key).Error; err != nil {
		t.Fatalf("save key: %v", err)
	}
	return *user, *key
}

func reloadKey(t *testing.T, id interface{}) models.APIKey {
	t.Helper()
	var k models.APIKey
	if err := db.DB.First(&k, "id = ?", id).Error; err != nil {
		t.Fatalf("reload key: %v", err)
	}
	return k
}

// BE-HIGH-01: PATCH /v1/api-keys/:id applied permissions and rate limit with none of the
// checks the create endpoint has, so any user could give their own key "admin".
func TestUpdateAPIKey_RejectsSelfGrantedAdminAndHugeRateLimit(t *testing.T) {
	testutil.SetupTestDB(t)
	user, key := newTestAPIKey(t, "buyer")

	w := patchAPIKey(t, key.ID.String(), user.ID.String(), "buyer", map[string]interface{}{"permissions": []string{"read", "admin"}})
	if w.Code != http.StatusForbidden {
		t.Fatalf("self-granting admin: got %d body %s, want 403", w.Code, w.Body.String())
	}

	w = patchAPIKey(t, key.ID.String(), user.ID.String(), "buyer", map[string]interface{}{"rate_limit_per_minute": 1_000_000_000})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("huge rate limit: got %d body %s, want 400", w.Code, w.Body.String())
	}

	w = patchAPIKey(t, key.ID.String(), user.ID.String(), "buyer", map[string]interface{}{"permissions": []string{"superuser"}})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("unknown permission: got %d body %s, want 400", w.Code, w.Body.String())
	}

	after := reloadKey(t, key.ID)
	if len(after.Permissions) != 1 || after.Permissions[0] != "read" || after.RateLimitPerMin != 100 {
		t.Fatalf("rejected updates changed the key: permissions %v rate %d", after.Permissions, after.RateLimitPerMin)
	}
}

func TestUpdateAPIKey_AllowsOrdinaryChangesAndAdministratorGrants(t *testing.T) {
	testutil.SetupTestDB(t)
	user, key := newTestAPIKey(t, "buyer")

	w := patchAPIKey(t, key.ID.String(), user.ID.String(), "buyer", map[string]interface{}{
		"permissions": []string{"read", "write", "proxy"}, "rate_limit_per_minute": 500,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("ordinary update: got %d body %s, want 200", w.Code, w.Body.String())
	}
	if got := reloadKey(t, key.ID); len(got.Permissions) != 3 || got.RateLimitPerMin != 500 {
		t.Fatalf("update not applied: permissions %v rate %d", got.Permissions, got.RateLimitPerMin)
	}

	// An administrator may grant admin and raise the cap.
	w = patchAPIKey(t, key.ID.String(), user.ID.String(), "admin", map[string]interface{}{
		"permissions": []string{"read", "admin"}, "rate_limit_per_minute": 50_000,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("administrator update: got %d body %s, want 200", w.Code, w.Body.String())
	}
}
