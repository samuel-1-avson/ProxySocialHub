package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

// TestPurchaseFlow_CreateActivateCredentials covers the escrow stand-in path:
// create order → activate-dev (mock pay) → credentials, including Redis sync.
func TestPurchaseFlow_CreateActivateCredentials(t *testing.T) {
	t.Setenv("PROXYHUB_ALLOW_DEV_ESCROW_ACTIVATE", "true")
	prices.SetTestSOLPrice(100)
	defer prices.SetTestSOLPrice(0)

	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t,
		"wallet_ledger_entries", "feed_events", "sessions", "orders",
		"proxy_listings", "provider_nodes", "linked_wallets", "wallets", "users",
	)

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_flow"), "provider")
	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("buyer_flow"), "buyer")

	if err := db.DB.Create(&models.LinkedWallet{
		UserID:    buyer.ID,
		Chain:     models.ChainSolana,
		Address:   "FlowBuyer11111111111111111111111111111111111",
		Verified:  true,
		IsPrimary: true,
	}).Error; err != nil {
		t.Fatalf("link wallet: %v", err)
	}

	nodeID := uuid.New()
	providerNode := models.ProviderNode{
		ID:        nodeID,
		UserID:    provider.ID,
		Name:      "flow-node",
		Status:    models.NodeOnline,
		IsHealthy: true,
		IPAddress: "10.0.0.9",
		Port:      1080,
	}
	if err := db.DB.Create(&providerNode).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	listing := models.ProxyListing{
		SellerID:             provider.ID,
		ProviderNodeID:       &nodeID,
		Title:                "Flow listing",
		PricePerGB:           2.0,
		AvailableBandwidthGB: 50,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("create listing: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", buyer.ID)
	})
	r.POST("/orders", createOrder)
	r.POST("/orders/:id/activate-dev", activateDevOrder)
	r.GET("/orders/:id/credentials", getOrderCredentials)

	createBody, _ := json.Marshal(models.CreateOrderRequest{
		ListingID:   listing.ID,
		BandwidthGB: 1,
	})
	createReq := httptest.NewRequest(http.MethodPost, "/orders", bytes.NewBuffer(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createW := httptest.NewRecorder()
	r.ServeHTTP(createW, createReq)
	if createW.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d body=%s", createW.Code, createW.Body.String())
	}
	var createResp struct {
		Order models.Order `json:"order"`
	}
	if err := json.Unmarshal(createW.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if createResp.Order.ID == uuid.Nil {
		t.Fatal("create returned empty order id")
	}
	orderID := createResp.Order.ID.String()

	actReq := httptest.NewRequest(http.MethodPost, "/orders/"+orderID+"/activate-dev", nil)
	actW := httptest.NewRecorder()
	r.ServeHTTP(actW, actReq)
	if actW.Code != http.StatusOK {
		t.Fatalf("activate-dev: expected 200, got %d body=%s", actW.Code, actW.Body.String())
	}

	credReq := httptest.NewRequest(http.MethodGet, "/orders/"+orderID+"/credentials", nil)
	credW := httptest.NewRecorder()
	r.ServeHTTP(credW, credReq)
	if credW.Code != http.StatusOK {
		t.Fatalf("credentials: expected 200, got %d body=%s", credW.Code, credW.Body.String())
	}
	var credResp struct {
		ProxyCredentials map[string]interface{} `json:"proxy_credentials"`
	}
	if err := json.Unmarshal(credW.Body.Bytes(), &credResp); err != nil {
		t.Fatalf("decode credentials: %v", err)
	}
	if credResp.ProxyCredentials["username"] == nil || credResp.ProxyCredentials["username"] == "" {
		t.Fatalf("missing credentials username: %v", credResp.ProxyCredentials)
	}

	var order models.Order
	if err := db.DB.First(&order, "id = ?", createResp.Order.ID).Error; err != nil {
		t.Fatalf("reload order: %v", err)
	}
	if order.Status != models.OrderStatusActive {
		t.Fatalf("order status=%s want active", order.Status)
	}
	if order.SessionID == nil {
		t.Fatal("order missing session")
	}
	var session models.Session
	if err := db.DB.First(&session, "id = ?", *order.SessionID).Error; err != nil {
		t.Fatalf("reload session: %v", err)
	}
	if session.Status != models.SessionActive {
		t.Fatalf("session status=%s want active", session.Status)
	}
	redisSession, err := redis.GetSession(session.CredentialsUser)
	if err != nil {
		t.Fatalf("redis session: %v", err)
	}
	if redisSession.NodeID != marketplace.GatewayRoutingNodeID(&providerNode) {
		t.Fatalf("redis node mismatch: %q", redisSession.NodeID)
	}
}
