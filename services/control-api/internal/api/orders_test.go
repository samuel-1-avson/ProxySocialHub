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

func TestCreateOrder_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	// Delete children (orders, ledger, listings, wallets) before parents (users)
	testutil.CleanupTestData(t, "wallet_ledger_entries", "orders", "proxy_listings", "wallets", "users")

	// 1. Setup Users
	provider := testutil.CreateTestUser(t, "provider@test.com", "provider")
	buyer := testutil.CreateTestUser(t, "buyer@test.com", "buyer")

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
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", provider.ID).Update("balance_ghs", 0)

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
	// 7a. Buyer Wallet deducted ($100 - $20 = $80)
	var updatedWallet models.Wallet
	db.DB.First(&updatedWallet, "user_id = ?", buyer.ID)
	if updatedWallet.BalanceGHS != 80.0 {
		t.Errorf("Expected buyer balance 80.0, got %f", updatedWallet.BalanceGHS)
	}

	// 7b. Platform Fee (10% = $2.00)
	// 7c. Seller Wallet Credited ($18.00)
	var sellerWallet models.Wallet
	db.DB.First(&sellerWallet, "user_id = ?", provider.ID)
	if sellerWallet.BalanceGHS != 18.0 {
		t.Errorf("Expected seller balance 18.0, got %f", sellerWallet.BalanceGHS)
	}

	// 7d. Order Created
	var order models.Order
	db.DB.Where("buyer_id = ?", buyer.ID).First(&order)
	if order.TotalPrice != 20.0 {
		t.Errorf("Expected order total 20.0, got %f", order.TotalPrice)
	}
	if order.Status != models.OrderStatusActive {
		t.Errorf("Expected order status active, got %s", order.Status)
	}
}

func TestCreateOrder_InsufficientFunds(t *testing.T) {
	testutil.SetupTestDB(t)
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

	// Wallet with $10
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", buyer.ID).Update("balance_ghs", 10.0)

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
