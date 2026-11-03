package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/middleware"
	"github.com/proxyhubb/control-api/internal/models"
)

// A provider node sends the JWT it gets from /v1/provider/gateway-token to the control API as
// well as to the edge gateway: for its lease, its node list and its heartbeats. The
// TestProviderNodeAPIContract sequence checks those calls with its own stand-in auth
// middleware, so it cannot notice the real one refusing this token. These tests send the same
// requests through the real chain (SupabaseAuthMiddlewareOptional, then RestrictProviderToken),
// wired the way main.go wires /v1.

func setupRealAuthProviderRouter() *gin.Engine {
	r := setupTestRouter()
	cfg := &config.Config{Auth: config.AuthConfig{JWTSecret: testJWTSecret}}

	v1 := r.Group("/v1")
	v1.Use(middleware.SupabaseAuthMiddlewareOptional(cfg))
	v1.Use(middleware.RestrictProviderToken())
	RegisterGatewayTokenRoute(v1)

	protected := v1.Group("/")
	protected.Use(middleware.RequireAuth())
	providerOps := protected.Group("/")
	providerOps.Use(middleware.RequireProviderRole())
	{
		RegisterProviderNodeRoutes(providerOps)
		RegisterProviderLeaseRoutes(providerOps)
	}
	// A route a node has no business calling, to show the token is confined to node routes.
	protected.GET("/wallet/balance", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	return r
}

func exchangeGatewayTokenForTest(t *testing.T, r *gin.Engine, rawToken string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"token": rawToken})
	req := httptest.NewRequest(http.MethodPost, "/v1/provider/gateway-token", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("gateway-token: status %d body %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		GatewayToken string `json:"gateway_token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil || resp.GatewayToken == "" {
		t.Fatalf("gateway-token response: %v %s", err, rec.Body.String())
	}
	return resp.GatewayToken
}

func gatewayTokenRequest(r *gin.Engine, method, path, gatewayJWT string, body []byte) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+gatewayJWT)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestGatewayTokenPassesRealAuthChain(t *testing.T) {
	rawToken, _ := setupProviderContractTest(t)
	r := setupRealAuthProviderRouter()
	jwt := exchangeGatewayTokenForTest(t, r, rawToken)

	leaseBody, _ := json.Marshal(issueProviderLeaseRequest{
		ConnectionType:    "residential",
		MaxConnections:    100,
		MaxBandwidthMbps:  100,
		UplinkSpeedKbps:   10000,
		DownlinkSpeedKbps: 50000,
		CPUCores:          4,
		MemoryMB:          8192,
		OS:                "windows",
		ClientVersion:     "provider-node-test",
	})
	if rec := gatewayTokenRequest(r, http.MethodPost, "/v1/provider/lease", jwt, leaseBody); rec.Code != http.StatusOK {
		t.Fatalf("lease with the gateway token: status %d body %s (the node cannot connect without it)", rec.Code, rec.Body.String())
	}

	nodeBody, _ := json.Marshal(CreateNodeRequest{
		Name:           "real-auth-node",
		IPAddress:      "203.0.113.20",
		Country:        "GH",
		City:           "Accra",
		ConnectionType: "residential",
	})
	rec := gatewayTokenRequest(r, http.MethodPost, "/v1/provider/nodes", jwt, nodeBody)
	if rec.Code != http.StatusCreated {
		t.Fatalf("register node with the gateway token: status %d body %s", rec.Code, rec.Body.String())
	}
	var node models.ProviderNode
	if err := json.Unmarshal(rec.Body.Bytes(), &node); err != nil {
		t.Fatalf("decode node: %v", err)
	}

	if rec := gatewayTokenRequest(r, http.MethodGet, "/v1/provider/nodes", jwt, nil); rec.Code != http.StatusOK {
		t.Fatalf("list nodes with the gateway token: status %d body %s", rec.Code, rec.Body.String())
	}

	hb, _ := json.Marshal(map[string]interface{}{"latency_ms": 42, "active_connections": 1, "uptime_percent": 99.5})
	if rec := gatewayTokenRequest(r, http.MethodPost, "/v1/provider/nodes/"+node.ID.String()+"/heartbeat", jwt, hb); rec.Code != http.StatusOK {
		t.Fatalf("heartbeat with the gateway token: status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestGatewayTokenIsConfinedToNodeRoutes(t *testing.T) {
	rawToken, _ := setupProviderContractTest(t)
	r := setupRealAuthProviderRouter()
	jwt := exchangeGatewayTokenForTest(t, r, rawToken)

	rec := gatewayTokenRequest(r, http.MethodGet, "/v1/wallet/balance", jwt, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("a node token on a non-node route: status %d body %s, want 403 provider_token_scope", rec.Code, rec.Body.String())
	}
}

func TestGatewayTokenRefusedWhenAccountIsInactive(t *testing.T) {
	rawToken, userID := setupProviderContractTest(t)
	r := setupRealAuthProviderRouter()
	jwt := exchangeGatewayTokenForTest(t, r, rawToken)

	if err := db.DB.Model(&models.User{}).Where("id = ?", userID).Update("status", models.UserStatusSuspended).Error; err != nil {
		t.Fatalf("suspend account: %v", err)
	}
	// The token is still unexpired and correctly signed, but its owner is suspended.
	if rec := gatewayTokenRequest(r, http.MethodGet, "/v1/provider/nodes", jwt, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("suspended account's gateway token: status %d body %s, want 401", rec.Code, rec.Body.String())
	}
}
