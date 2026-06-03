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
	"github.com/proxyhubb/control-api/internal/prices"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestCreateOrder_Success(t *testing.T) {
	prices.SetTestSOLPrice(100)
	defer prices.SetTestSOLPrice(0)

	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	// Delete children (orders, ledger, listings, wallets) before parents (users)
	testutil.CleanupTestData(t, "wallet_ledger_entries", "feed_events", "sessions", "orders", "proxy_listings", "wallets", "users")

	// 1. Setup Users
	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_order_success"), "provider")
	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("buyer_order_success"), "buyer")

	// 2. Setup Listing ($10/GB)
	listing := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "Test Listing",
		PricePerGB:           10.0,
		AvailableBandwidthGB: 100,
		Status:               models.ListingStatusActive,
	}
	db.DB.Create(&listing)

	// 3. Fund Buyer Wallet ($100) - Already created by CreateTestUser
	// Set Seller Wallet to 0 for clear calculations
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", provider.ID).Update("balance_sol", 0)

	// 4. Router
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", buyer.ID) // orders.go casts to uuid.UUID directly
	})
	r.POST("/orders", createOrder)

	// 5. Request (Buy 2GB -> $20)
	reqBody := models.CreateOrderRequest{
		ListingID:   listing.ID,
		BandwidthGB: 2.0,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req := httptest.NewRequest("POST", "/orders", bytes.NewBuffer(jsonBody))
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	// 6. Verify Response
	if w.Code != http.StatusCreated {
		t.Errorf("Expected 201 Created, got %d. Body: %s", w.Code, w.Body.String())
	}

	// 7. Verify Database State
	// 7a. Buyer Wallet is only preflight-checked here; funds move via escrow/settlement.
	var updatedWallet models.Wallet
	db.DB.First(&updatedWallet, "user_id = ?", buyer.ID)
	if updatedWallet.BalanceSOL != 100.0 {
		t.Errorf("Expected buyer balance to remain 100.0 before escrow settlement, got %f", updatedWallet.BalanceSOL)
	}

	// 7b. Seller Wallet is credited after usage proof settlement.
	var sellerWallet models.Wallet
	db.DB.First(&sellerWallet, "user_id = ?", provider.ID)
	if sellerWallet.BalanceSOL != 0.0 {
		t.Errorf("Expected seller balance to remain 0.0 before settlement, got %f", sellerWallet.BalanceSOL)
	}

	// 7d. Order Created
	var order models.Order
	db.DB.Where("buyer_id = ?", buyer.ID).First(&order)
	if order.TotalPrice != 20.0 {
		t.Errorf("Expected order total 20.0, got %f", order.TotalPrice)
	}
	if order.BandwidthGB != 2.0 {
		t.Errorf("Expected order bandwidth 2.0GB, got %f", order.BandwidthGB)
	}
	if order.BandwidthLimitGB != 2 {
		t.Errorf("Expected order bandwidth limit 2GB, got %d", order.BandwidthLimitGB)
	}
	if order.Status != models.OrderStatusPending {
		t.Errorf("Expected order status pending before escrow payment, got %s", order.Status)
	}
	if order.SessionID == nil {
		t.Fatal("Expected order to be linked to a session")
	}
	var session models.Session
	if err := db.DB.First(&session, "id = ?", order.SessionID).Error; err != nil {
		t.Fatalf("expected linked session to exist: %v", err)
	}
	if session.Status != models.SessionDisabled {
		t.Errorf("Expected linked session disabled until escrow, got %s", session.Status)
	}
	if session.ListingID == nil || *session.ListingID != listing.ID {
		t.Errorf("Expected session to reference listing %s, got %v", listing.ID, session.ListingID)
	}
	if session.BandwidthLimit != 2*1024*1024*1024 {
		t.Errorf("Expected linked session bandwidth limit 2GB in bytes, got %d", session.BandwidthLimit)
	}
}

func TestCreateOrder_InsufficientFunds(t *testing.T) {
	prices.SetTestSOLPrice(100)
	defer prices.SetTestSOLPrice(0)

	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "wallets", "proxy_listings")

	// 1. Setup
	provider := testutil.CreateTestUser(t, "p@test.com", "provider")
	buyer := testutil.CreateTestUser(t, "b_broke@test.com", "buyer")

	listing := models.ProxyListing{
		SellerID:   provider.ID,
		PricePerGB: 50.0,
		Status:     models.ListingStatusActive,
	}
	db.DB.Create(&listing)

	// 0.1 SOL is below ~0.5 SOL required for a $50 order at $100/SOL
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", buyer.ID).Update("balance_sol", 0.1)

	// 2. Router
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", buyer.ID)
	})
	r.POST("/orders", createOrder)

	// 3. Request (Buy 1GB -> $50)
	reqBody := models.CreateOrderRequest{
		ListingID:   listing.ID,
		BandwidthGB: 1.0,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req := httptest.NewRequest("POST", "/orders", bytes.NewBuffer(jsonBody))
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	// 4. Verify
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 Bad Request, got %d", w.Code)
	}
}

func TestCreateOrder_BlocksInactiveListings(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "feed_events", "sessions", "orders", "users", "wallets", "proxy_listings")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_order_inactive"), "provider")
	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("buyer_order_inactive"), "buyer")

	for _, status := range []models.ListingStatus{models.ListingStatusPaused, models.ListingStatusSoldOut, models.ListingStatusDeleted} {
		t.Run(string(status), func(t *testing.T) {
			listing := models.ProxyListing{
				SellerID:             provider.ID,
				Title:                "Unavailable Listing",
				PricePerGB:           1,
				AvailableBandwidthGB: 10,
				Status:               status,
			}
			if err := db.DB.Create(&listing).Error; err != nil {
				t.Fatalf("failed to create listing: %v", err)
			}

			r := setupTestRouter()
			r.Use(func(c *gin.Context) {
				c.Set("user_id", buyer.ID)
			})
			r.POST("/orders", createOrder)

			reqBody := models.CreateOrderRequest{ListingID: listing.ID, BandwidthGB: 1}
			jsonBody, _ := json.Marshal(reqBody)
			req := httptest.NewRequest("POST", "/orders", bytes.NewBuffer(jsonBody))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusConflict {
				t.Fatalf("expected 409 for %s listing, got %d: %s", status, w.Code, w.Body.String())
			}

			var count int64
			db.DB.Model(&models.Order{}).Where("listing_id = ?", listing.ID).Count(&count)
			if count != 0 {
				t.Fatalf("expected no order for inactive listing, got %d", count)
			}
		})
	}
}

func TestCancelOrder_BlocksTerminalOrders(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "orders", "proxy_listings", "wallets", "users")

	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("buyer_cancel_terminal"), "buyer")
	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_cancel_terminal"), "provider")
	listing := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "Terminal Order Listing",
		PricePerGB:           1,
		AvailableBandwidthGB: 10,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("failed to create listing: %v", err)
	}

	for _, status := range []models.OrderStatus{models.OrderStatusCompleted, models.OrderStatusCancelled, models.OrderStatusRefunded} {
		t.Run(string(status), func(t *testing.T) {
			order := models.Order{
				BuyerID:   buyer.ID,
				SellerID:  provider.ID,
				ListingID: listing.ID,
				Status:    status,
			}
			if err := db.DB.Create(&order).Error; err != nil {
				t.Fatalf("failed to create order: %v", err)
			}

			r := setupTestRouter()
			r.Use(func(c *gin.Context) {
				c.Set("user_id", buyer.ID)
			})
			r.POST("/orders/:id/cancel", cancelOrder)

			req := httptest.NewRequest("POST", "/orders/"+order.ID.String()+"/cancel", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for cancelling %s order, got %d: %s", status, w.Code, w.Body.String())
			}
		})
	}
}

func TestGetMyOrders(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "orders", "proxy_listings")

	buyer := testutil.CreateTestUser(t, "buyer_orders@test.com", "buyer")
	provider := testutil.CreateTestUser(t, "seller_orders@test.com", "provider")

	l := models.ProxyListing{SellerID: provider.ID, Title: "Item"}
	db.DB.Create(&l)

	// Create 2 orders
	db.DB.Create(&models.Order{BuyerID: buyer.ID, SellerID: provider.ID, ListingID: l.ID, TotalPrice: 10})
	db.DB.Create(&models.Order{BuyerID: buyer.ID, SellerID: provider.ID, ListingID: l.ID, TotalPrice: 20})

	// Router
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", buyer.ID)
	})
	r.GET("/orders", getMyOrders)

	req := httptest.NewRequest("GET", "/orders", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200 OK, got %d", w.Code)
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)

	// Check total
	if resp["total"].(float64) != 2 {
		t.Errorf("Expected 2 orders, got %v", resp["total"])
	}
}
