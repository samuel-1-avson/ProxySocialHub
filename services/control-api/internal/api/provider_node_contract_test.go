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
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/middleware"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

const (
	testJWTSecret       = "test-jwt-secret-for-ci-min-32-chars-long"
	testTokenHMACSecret = "test-token-hmac-secret-for-ci-32-chars"
)

func setupProviderContractTest(t *testing.T) (rawToken string, userID uuid.UUID) {
	t.Helper()
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_tokens", "provider_nodes", "provider_node_registrations", "nodes")

	t.Setenv("JWT_SECRET", testJWTSecret)
	t.Setenv("TOKEN_HMAC_SECRET", testTokenHMACSecret)
	t.Setenv("PROVIDER_SIGNATURE_MODE", "observe")

	models.TokenHashFn = crypto.NewTokenHashFn(testTokenHMACSecret)

	email := testutil.UniqueEmail("provider-contract")
	user := testutil.CreateTestUser(t, email, "provider")

	raw, err := models.GenerateRawToken()
	if err != nil {
		t.Fatalf("GenerateRawToken: %v", err)
	}

	token := models.ProviderToken{
		ID:       uuid.New(),
		UserID:   user.ID,
		Token:    models.HashToken(raw),
		Name:     "contract-test",
		IsActive: true,
	}
	if err := db.DB.Create(&token).Error; err != nil {
		t.Fatalf("create provider token: %v", err)
	}

	return raw, user.ID
}

func providerContractAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.Next()
			return
		}
		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := crypto.ValidateToken(tokenString, testJWTSecret)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			return
		}
		uid, err := uuid.Parse(claims.UserID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid user in token"})
			return
		}
		c.Set("user_id", uid)
		c.Set("userRole", claims.Role)
		c.Next()
	}
}

func setupProviderContractRouter() *gin.Engine {
	r := setupTestRouter()
	r.POST("/v1/provider/gateway-token", issueGatewayToken)

	protected := r.Group("/v1")
	protected.Use(providerContractAuthMiddleware())
	protected.Use(middleware.RequireAuth())
	providerOps := protected.Group("/")
	providerOps.Use(middleware.RequireProviderRole())
	{
		RegisterProviderNodeRoutes(providerOps)
		RegisterProviderLeaseRoutes(providerOps)
	}
	return r
}

// TestProviderNodeAPIContract exercises the HTTP sequence provider-node uses against control-api.
func TestProviderNodeAPIContract(t *testing.T) {
	rawToken, userID := setupProviderContractTest(t)
	r := setupProviderContractRouter()

	// 1) gateway-token (public)
	gwBody, _ := json.Marshal(map[string]string{"token": rawToken})
	gwReq := httptest.NewRequest(http.MethodPost, "/v1/provider/gateway-token", bytes.NewReader(gwBody))
	gwReq.Header.Set("Content-Type", "application/json")
	gwRec := httptest.NewRecorder()
	r.ServeHTTP(gwRec, gwReq)
	if gwRec.Code != http.StatusOK {
		t.Fatalf("gateway-token: status %d body %s", gwRec.Code, gwRec.Body.String())
	}

	var gwResp struct {
		GatewayToken string    `json:"gateway_token"`
		UserID       uuid.UUID `json:"user_id"`
	}
	if err := json.Unmarshal(gwRec.Body.Bytes(), &gwResp); err != nil {
		t.Fatalf("gateway-token decode: %v", err)
	}
	if gwResp.GatewayToken == "" {
		t.Fatal("gateway-token missing gateway_token")
	}
	if gwResp.UserID != userID {
		t.Fatalf("gateway-token user_id = %s, want %s", gwResp.UserID, userID)
	}

	authHeader := "Bearer " + gwResp.GatewayToken

	// 2) register node
	nodeBody, _ := json.Marshal(CreateNodeRequest{
		Name:             "contract-node",
		IPAddress:        "203.0.113.10",
		Country:          "US",
		City:             "Test",
		ConnectionType:   "residential",
	})
	nodeReq := httptest.NewRequest(http.MethodPost, "/v1/provider/nodes", bytes.NewReader(nodeBody))
	nodeReq.Header.Set("Content-Type", "application/json")
	nodeReq.Header.Set("Authorization", authHeader)
	nodeRec := httptest.NewRecorder()
	r.ServeHTTP(nodeRec, nodeReq)
	if nodeRec.Code != http.StatusCreated {
		t.Fatalf("create node: status %d body %s", nodeRec.Code, nodeRec.Body.String())
	}

	var node models.ProviderNode
	if err := json.Unmarshal(nodeRec.Body.Bytes(), &node); err != nil {
		t.Fatalf("create node decode: %v", err)
	}
	if node.UserID != userID {
		t.Fatalf("node user_id = %s, want %s", node.UserID, userID)
	}

	// 3) provider lease
	leaseBody, _ := json.Marshal(issueProviderLeaseRequest{
		ConnectionType:   "residential",
		MaxConnections:   100,
		MaxBandwidthMbps: 100,
		UplinkSpeedKbps:  10000,
		DownlinkSpeedKbps: 50000,
		CPUCores:         4,
		MemoryMB:         8192,
		OS:               "linux",
		ClientVersion:    "provider-node-test",
	})
	leaseReq := httptest.NewRequest(http.MethodPost, "/v1/provider/lease", bytes.NewReader(leaseBody))
	leaseReq.Header.Set("Content-Type", "application/json")
	leaseReq.Header.Set("Authorization", authHeader)
	leaseRec := httptest.NewRecorder()
	r.ServeHTTP(leaseRec, leaseReq)
	if leaseRec.Code != http.StatusOK {
		t.Fatalf("provider lease: status %d body %s", leaseRec.Code, leaseRec.Body.String())
	}
	var leaseResp struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(leaseRec.Body.Bytes(), &leaseResp); err != nil {
		t.Fatalf("lease decode: %v", err)
	}
	if leaseResp.Token == "" {
		t.Fatal("lease missing token")
	}

	// 4) heartbeat
	hbBody, _ := json.Marshal(map[string]interface{}{
		"latency_ms":         42,
		"active_connections": 1,
		"uptime_percent":     99.5,
	})
	hbReq := httptest.NewRequest(http.MethodPost, "/v1/provider/nodes/"+node.ID.String()+"/heartbeat", bytes.NewReader(hbBody))
	hbReq.Header.Set("Content-Type", "application/json")
	hbReq.Header.Set("Authorization", authHeader)
	hbRec := httptest.NewRecorder()
	r.ServeHTTP(hbRec, hbReq)
	if hbRec.Code != http.StatusOK {
		t.Fatalf("heartbeat: status %d body %s", hbRec.Code, hbRec.Body.String())
	}

	var updated models.ProviderNode
	if err := db.DB.First(&updated, "id = ?", node.ID).Error; err != nil {
		t.Fatalf("reload node: %v", err)
	}
	if updated.Status != models.NodeOnline {
		t.Fatalf("expected node online after heartbeat, got %s", updated.Status)
	}
}

func TestProviderNodeAPIContract_BuyerDenied(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")

	t.Setenv("JWT_SECRET", testJWTSecret)

	email := testutil.UniqueEmail("buyer-contract")
	buyer := testutil.CreateTestUser(t, email, "buyer")

	jwt, err := crypto.GenerateToken(buyer.ID, "buyer", email, "", testJWTSecret, gatewayTokenTTL)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	r := setupTestRouter()
	r.Use(providerContractAuthMiddleware())
	r.Use(middleware.RequireAuth())
	providerOps := r.Group("/v1")
	providerOps.Use(middleware.RequireProviderRole())
	RegisterProviderNodeRoutes(providerOps)

	body, _ := json.Marshal(CreateNodeRequest{Name: "blocked", IPAddress: "127.0.0.1"})
	req := httptest.NewRequest(http.MethodPost, "/v1/provider/nodes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+jwt)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("buyer create node: status %d, want 403. body %s", rec.Code, rec.Body.String())
	}
}
