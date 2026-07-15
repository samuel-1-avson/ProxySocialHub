package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/prices"
	"github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestActivateDevOrder_ActivatesSessionAndRedis(t *testing.T) {
	t.Setenv("PROXYHUB_ALLOW_DEV_ESCROW_ACTIVATE", "true")
	prices.SetTestSOLPrice(100)
	defer prices.SetTestSOLPrice(0)

	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "wallet_ledger_entries", "feed_events", "sessions", "orders", "proxy_listings", "provider_nodes", "wallets", "users")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_dev_activate"), "provider")
	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("buyer_dev_activate"), "buyer")

	nodeID := uuid.New()
	providerNode := models.ProviderNode{
		ID:        nodeID,
		UserID:    provider.ID,
		Name:      "dev-activate-node",
		Status:    models.NodeOnline,
		IsHealthy: true,
		IPAddress: "10.0.0.2",
		Port:      1080,
	}
	if err := db.DB.Create(&providerNode).Error; err != nil {
		t.Fatalf("create provider node: %v", err)
	}

	listing := models.ProxyListing{
		SellerID:             provider.ID,
		ProviderNodeID:       &nodeID,
		Title:                "Dev activate listing",
		PricePerGB:           1.0,
		AvailableBandwidthGB: 10,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("create listing: %v", err)
	}

	credUser := "dev-buyer-user"
	credPass := "dev-buyer-pass"
	sessionID := uuid.New()
	session := models.Session{
		ID:              sessionID,
		UserID:          buyer.ID,
		NodeID:          &nodeID,
		ListingID:       &listing.ID,
		Type:            models.SessionRotating,
		Status:          models.SessionDisabled,
		CredentialsUser: credUser,
		CredentialsPass: credPass,
		BandwidthLimit:  1024 * 1024 * 1024,
		Config:          "{}",
	}
	if err := db.DB.Create(&session).Error; err != nil {
		t.Fatalf("create session: %v", err)
	}

	order := models.Order{
		BuyerID:     buyer.ID,
		SellerID:    provider.ID,
		ListingID:   listing.ID,
		BandwidthGB: 1,
		PricePerGB:  1,
		TotalPrice:  1,
		Status:      models.OrderStatusPending,
		SessionID:   &sessionID,
	}
	if err := db.DB.Create(&order).Error; err != nil {
		t.Fatalf("create order: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", buyer.ID)
	})
	r.POST("/orders/:id/activate-dev", activateDevOrder)

	req := httptest.NewRequest(http.MethodPost, "/orders/"+order.ID.String()+"/activate-dev", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", w.Code, w.Body.String())
	}

	var payload struct {
		Order struct {
			Status string `json:"status"`
		} `json:"order"`
		ProxyCredentials map[string]interface{} `json:"proxy_credentials"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Order.Status != string(models.OrderStatusActive) {
		t.Fatalf("expected active order, got %q", payload.Order.Status)
	}
	if payload.ProxyCredentials["username"] != credUser {
		t.Fatalf("unexpected credentials username: %v", payload.ProxyCredentials["username"])
	}

	var updated models.Session
	if err := db.DB.First(&updated, "id = ?", sessionID).Error; err != nil {
		t.Fatalf("reload session: %v", err)
	}
	if updated.Status != models.SessionActive {
		t.Fatalf("expected session active, got %s", updated.Status)
	}

	redisSession, err := redis.GetSession(credUser)
	if err != nil {
		t.Fatalf("redis session missing: %v", err)
	}
	wantNode := marketplace.GatewayRoutingNodeID(&providerNode)
	if redisSession.NodeID != wantNode {
		t.Fatalf("redis node_id: got %q want %q", redisSession.NodeID, wantNode)
	}
	if redisSession.ListingID != listing.ID.String() {
		t.Fatalf("redis listing_id: got %q", redisSession.ListingID)
	}
	if redisSession.CredentialPasswordHash != marketplace.HashCredentialPassword(credPass) {
		t.Fatal("redis password hash mismatch")
	}
}

func TestActivateDevOrder_DisabledWithoutEnv(t *testing.T) {
	t.Setenv("PROXYHUB_ALLOW_DEV_ESCROW_ACTIVATE", "")
	os.Setenv("GIN_MODE", "release")
	t.Cleanup(func() { os.Unsetenv("GIN_MODE") })

	r := setupTestRouter()
	r.POST("/orders/:id/activate-dev", activateDevOrder)

	req := httptest.NewRequest(http.MethodPost, "/orders/"+uuid.New().String()+"/activate-dev", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when disabled, got %d", w.Code)
	}
}
