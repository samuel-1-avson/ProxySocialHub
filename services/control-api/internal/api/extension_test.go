package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/middleware"
	"github.com/proxyhubb/control-api/internal/testutil"
)

const extensionTestJWTSecret = "test-jwt-secret-for-ci-min-32-chars-long"
const testExtensionID = "abcdefghijklmnopabcdefghijklmnop"

func TestExtensionPairFinish_IssuesDeviceJWT(t *testing.T) {
	runExtensionPairFlow(t, testExtensionID)
}

// Firefox reports its add-on id (manifest gecko.id), not a 32-char Chrome id.
func TestExtensionPairFinish_FirefoxAddonID(t *testing.T) {
	runExtensionPairFlow(t, "extension@proxyhubb.com")
}

func TestExtensionPairFinish_RejectsBadExtensionID(t *testing.T) {
	r := setupTestRouter()
	r.POST("/v1/extension/pair/finish", finishExtensionPair)
	for _, id := range []string{"", "not an id", "{nope}"} {
		body, _ := json.Marshal(map[string]string{"code": "ABCD2345", "extension_id": id})
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/v1/extension/pair/finish", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest && w.Code != http.StatusServiceUnavailable {
			t.Fatalf("extension_id %q: want 400 got %d", id, w.Code)
		}
	}
}

func runExtensionPairFlow(t *testing.T, extensionID string) {
	t.Helper()
	t.Setenv("JWT_SECRET", extensionTestJWTSecret)
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "extension_pair_codes", "extension_devices", "users")

	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("ext_buyer"), "buyer")

	r := setupTestRouter()
	r.POST("/v1/extension/pair/start", func(c *gin.Context) {
		c.Set("user_id", buyer.ID)
		c.Set("userID", buyer.ID.String())
		startExtensionPair(c)
	})
	r.POST("/v1/extension/pair/finish", finishExtensionPair)
	r.GET("/v1/extension/bootstrap", func(c *gin.Context) {
		tok := c.GetHeader("Authorization")
		if len(tok) < 8 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}
		claims, err := crypto.ValidateToken(tok[7:], extensionTestJWTSecret)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			return
		}
		uid, _ := uuid.Parse(claims.UserID)
		c.Set("user_id", uid)
		c.Set("userID", claims.UserID)
		if !claims.IsExtensionDevice() || !middleware.ExtensionDeviceActive(claims.DeviceID, claims.ExtID) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "device"})
			return
		}
		c.Set("auth_type", middleware.AuthTypeExtensionDevice)
		getExtensionBootstrap(c)
	})

	startReq := httptest.NewRequest(http.MethodPost, "/v1/extension/pair/start", nil)
	startW := httptest.NewRecorder()
	r.ServeHTTP(startW, startReq)
	if startW.Code != http.StatusOK {
		t.Fatalf("pair/start: %d %s", startW.Code, startW.Body.String())
	}
	var startBody struct {
		Code      string `json:"code"`
		ExpiresIn int    `json:"expires_in"`
	}
	if err := json.Unmarshal(startW.Body.Bytes(), &startBody); err != nil {
		t.Fatalf("decode start: %v", err)
	}
	if startBody.Code == "" || startBody.ExpiresIn != 60 {
		t.Fatalf("start body: %+v", startBody)
	}

	finishBody, _ := json.Marshal(map[string]string{
		"code":         startBody.Code,
		"extension_id": extensionID,
	})
	finishReq := httptest.NewRequest(http.MethodPost, "/v1/extension/pair/finish", bytes.NewBuffer(finishBody))
	finishReq.Header.Set("Content-Type", "application/json")
	finishW := httptest.NewRecorder()
	r.ServeHTTP(finishW, finishReq)
	if finishW.Code != http.StatusOK {
		t.Fatalf("pair/finish: %d %s", finishW.Code, finishW.Body.String())
	}
	var finishResp struct {
		Token        string `json:"token"`
		RefreshToken string `json:"refresh_token"`
		User         struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	if err := json.Unmarshal(finishW.Body.Bytes(), &finishResp); err != nil {
		t.Fatalf("decode finish: %v", err)
	}
	if finishResp.Token == "" || finishResp.RefreshToken == "" {
		t.Fatal("missing device tokens")
	}
	if finishResp.User.ID != buyer.ID.String() {
		t.Fatalf("user id %s want %s", finishResp.User.ID, buyer.ID.String())
	}
	claims, err := crypto.ValidateToken(finishResp.Token, extensionTestJWTSecret)
	if err != nil || !claims.IsExtensionDevice() {
		t.Fatalf("device jwt: %v claims=%+v", err, claims)
	}

	reuseReq := httptest.NewRequest(http.MethodPost, "/v1/extension/pair/finish", bytes.NewBuffer(finishBody))
	reuseReq.Header.Set("Content-Type", "application/json")
	reuseW := httptest.NewRecorder()
	r.ServeHTTP(reuseW, reuseReq)
	if reuseW.Code != http.StatusUnauthorized {
		t.Fatalf("reused code: want 401 got %d", reuseW.Code)
	}

	bootReq := httptest.NewRequest(http.MethodGet, "/v1/extension/bootstrap", nil)
	bootReq.Header.Set("Authorization", "Bearer "+finishResp.Token)
	bootW := httptest.NewRecorder()
	r.ServeHTTP(bootW, bootReq)
	if bootW.Code != http.StatusOK {
		t.Fatalf("bootstrap: %d %s", bootW.Code, bootW.Body.String())
	}
	var boot struct {
		ConnectReady bool   `json:"connect_ready"`
		Note         string `json:"note"`
		Proxy        struct {
			Endpoint        string `json:"endpoint"`
			AuthForEndpoint string `json:"auth_for_endpoint"`
		} `json:"proxy"`
	}
	if err := json.Unmarshal(bootW.Body.Bytes(), &boot); err != nil {
		t.Fatalf("decode bootstrap: %v", err)
	}
	if !boot.ConnectReady {
		t.Fatal("connect_ready")
	}
	if boot.Proxy.AuthForEndpoint != "hmac" {
		t.Fatalf("auth_for_endpoint %q", boot.Proxy.AuthForEndpoint)
	}
	if strings.Contains(strings.ToLower(boot.Note), "pairing only") {
		t.Fatalf("stale bootstrap note: %s", boot.Note)
	}

	guard := setupTestRouter()
	guard.Use(func(c *gin.Context) {
		c.Set("auth_type", middleware.AuthTypeExtensionDevice)
		c.Set("user_id", buyer.ID)
	})
	guard.Use(middleware.RestrictExtensionDevice())
	guard.GET("/v1/orders", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	guard.POST("/v1/orders", func(c *gin.Context) { c.JSON(http.StatusCreated, gin.H{"ok": true}) })

	gGet := httptest.NewRecorder()
	guard.ServeHTTP(gGet, httptest.NewRequest(http.MethodGet, "/v1/orders", nil))
	if gGet.Code != http.StatusOK {
		t.Fatalf("GET orders with device token: %d", gGet.Code)
	}
	gPost := httptest.NewRecorder()
	guard.ServeHTTP(gPost, httptest.NewRequest(http.MethodPost, "/v1/orders", nil))
	if gPost.Code != http.StatusForbidden {
		t.Fatalf("POST orders with device token: want 403 got %d", gPost.Code)
	}
}

func TestStartExtensionPair_RejectsDeviceAuth(t *testing.T) {
	t.Setenv("JWT_SECRET", extensionTestJWTSecret)
	testutil.SetupTestDB(t)
	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("ext_device_start"), "buyer")
	r := setupTestRouter()
	r.POST("/v1/extension/pair/start", func(c *gin.Context) {
		c.Set("user_id", buyer.ID)
		c.Set("auth_type", middleware.AuthTypeExtensionDevice)
		startExtensionPair(c)
	})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/extension/pair/start", nil))
	if w.Code != http.StatusForbidden {
		t.Fatalf("want 403 got %d %s", w.Code, w.Body.String())
	}
}
