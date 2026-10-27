package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestConfirmEscrowFailClosedNoPDA(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("PROXYHUB_REQUIRE_ESCROW_PDA", "true")
	testutil.SetupTestDB(t)

	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("escrow_failclosed_buyer"), "buyer")
	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("escrow_failclosed_seller"), "provider")
	listing := models.ProxyListing{
		SellerID:             seller.ID,
		Title:                "escrow failclosed listing",
		PricePerGB:           1,
		AvailableBandwidthGB: 1,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("create listing: %v", err)
	}
	buyerID := buyer.ID
	sellerID := seller.ID
	listingID := listing.ID
	order := models.Order{
		ID:          uuid.New(),
		BuyerID:     buyerID,
		SellerID:    sellerID,
		ListingID:   listingID,
		BandwidthGB: 1,
		PricePerGB:  1,
		TotalPrice:  1,
		Status:      models.OrderStatusPendingPayment,
		EscrowPDA:   "", // missing PDA
	}
	if err := db.DB.Create(&order).Error; err != nil {
		t.Fatalf("create order: %v", err)
	}

	r := gin.New()
	r.POST("/v1/orders/:id/confirm-escrow", func(c *gin.Context) {
		c.Set("user_id", buyerID)
		c.Set("userID", buyerID.String())
		confirmEscrow(c)
	})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/orders/"+order.ID.String()+"/confirm-escrow", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["code"] != "escrow_pda_required" {
		t.Fatalf("code=%v body=%s", body["code"], w.Body.String())
	}
}

func TestDevEscrowActivateDisabledWhenRequireEscrowPDA(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_ESCROW_PDA", "true")
	t.Setenv("PROXYHUB_ALLOW_DEV_ESCROW_ACTIVATE", "true")
	t.Setenv("APP_ENV", "development")
	if devEscrowActivateEnabled() {
		t.Fatal("activate-dev must be disabled when REQUIRE_ESCROW_PDA=true")
	}
}

func TestEnqueueEscrowSettleCreatesPendingRow(t *testing.T) {
	testutil.SetupTestDB(t)
	order := &models.Order{
		ID:              uuid.New(),
		BuyerID:         testutil.CreateTestUserID(t, "buyer"),
		SellerID:        testutil.CreateTestUserID(t, "provider"),
		ListingID:       uuid.New(),
		BandwidthGB:     1,
		PricePerGB:      1,
		TotalPrice:      1,
		Status:          models.OrderStatusActive,
		EscrowPDA:       "11111111111111111111111111111111",
		BuyerWallet:     "Buyer1111111111111111111111111111111",
		SellerWallet:    "Seller111111111111111111111111111111",
		AmountLockedSOL: 0.5,
		BandwidthLimitGB: 1,
	}
	EnqueueEscrowSettle(order, "test")
	var n int64
	if err := db.DB.Model(&models.CompensationOutbox{}).
		Where("kind = ? AND reference_id = ?", models.CompensationKindEscrowSettle, "escrow_settle:"+order.ID.String()).
		Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("expected 1 outbox row, got %d", n)
	}
}
