package api

import (
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestLoadOrderForJurySettlement_UsesOrderIDAsDisputeID(t *testing.T) {
	testutil.SetupTestDB(t)
	buyer := testutil.CreateTestUserID(t, "buyer")
	seller := testutil.CreateTestUserID(t, "provider")
	orderID := uuid.New()
	order := models.Order{
		ID:          orderID,
		BuyerID:     buyer,
		SellerID:    seller,
		Status:      models.OrderStatusDisputed,
		EscrowPDA:   "EscrowPDA11111111111111111111111111111111111",
		BuyerWallet: "Buyer111111111111111111111111111111111111111",
		SellerWallet: "Seller11111111111111111111111111111111111111",
	}
	if err := db.DB.Create(&order).Error; err != nil {
		t.Skipf("cannot create order in test DB: %v", err)
	}
	jury := models.DisputeJury{DisputeID: orderID}
	got, err := loadOrderForJurySettlement(jury)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got.ID != orderID {
		t.Fatalf("got order %s want %s", got.ID, orderID)
	}
}
