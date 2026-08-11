package billing

import (
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestEvaluateEscrowCustodialGate_OrderWithPDASkips(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_ESCROW_PDA", "true")
	testutil.SetupTestDB(t)

	sessionID := uuid.New()
	session := &models.Session{
		ID:     sessionID,
		UserID: uuid.New(),
		Type:   models.SessionUniversal,
		Status: models.SessionActive,
		Config: "{}",
	}
	if err := db.DB.Create(session).Error; err != nil {
		t.Fatalf("session: %v", err)
	}
	order := models.Order{
		ID:            uuid.New(),
		BuyerID:       session.UserID,
		SellerID:      uuid.New(),
		ListingID:     uuid.New(),
		BandwidthGB:   1,
		PricePerGB:    1,
		TotalPrice:    1,
		Status:        models.OrderStatusActive,
		SessionID:     &sessionID,
		EscrowPDA:     "EscrowPDA111111111111111111111111111",
		PaymentMethod: "solana_escrow",
	}
	if err := db.DB.Create(&order).Error; err != nil {
		t.Fatalf("order: %v", err)
	}

	skip, refuse, reason := evaluateEscrowCustodialGate(session)
	if !skip || refuse || reason != "order_escrow_pda" {
		t.Fatalf("expected skip order_escrow_pda, got skip=%v refuse=%v reason=%q", skip, refuse, reason)
	}
}

func TestEvaluateEscrowCustodialGate_MarketplaceOrderMissingPDARefuses(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_ESCROW_PDA", "true")
	testutil.SetupTestDB(t)

	sessionID := uuid.New()
	session := &models.Session{
		ID:     sessionID,
		UserID: uuid.New(),
		Type:   models.SessionUniversal,
		Status: models.SessionActive,
		Config: "{}",
	}
	if err := db.DB.Create(session).Error; err != nil {
		t.Fatalf("session: %v", err)
	}
	order := models.Order{
		ID:          uuid.New(),
		BuyerID:     session.UserID,
		SellerID:    uuid.New(),
		ListingID:   uuid.New(),
		BandwidthGB: 1,
		PricePerGB:  1,
		TotalPrice:  1,
		Status:      models.OrderStatusActive,
		SessionID:   &sessionID,
		EscrowPDA:   "",
		// PaymentMethod empty / non-escrow but order linked → refuse when flag on
	}
	if err := db.DB.Create(&order).Error; err != nil {
		t.Fatalf("order: %v", err)
	}

	skip, refuse, reason := evaluateEscrowCustodialGate(session)
	if skip || !refuse || reason != "order_missing_escrow_pda" {
		t.Fatalf("expected refuse order_missing_escrow_pda, got skip=%v refuse=%v reason=%q", skip, refuse, reason)
	}
}
