package billing

import (
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
	"gorm.io/gorm"
)

// createOrderWithoutFKs inserts an order whose buyer/seller/listing rows do not
// exist. The gate only reads escrow_pda and payment_method, so the FK targets are
// irrelevant here; SET LOCAL keeps the bypass scoped to this one transaction.
func createOrderWithoutFKs(order *models.Order) error {
	return db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL session_replication_role = 'replica'").Error; err != nil {
			return err
		}
		return tx.Create(order).Error
	})
}

func TestEvaluateEscrowCustodialGate_OrderWithPDASkips(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_ESCROW_PDA", "true")
	testutil.SetupTestDB(t)

	sessionID := uuid.New()
	session := &models.Session{
		ID:     sessionID,
		UserID: testutil.CreateTestUserID(t, "buyer"),
		Type:   models.SessionUniversal,
		Status: models.SessionActive,
		Config: "{}",
	}
	if err := db.DB.Create(session).Error; err != nil {
		t.Fatalf("session: %v", err)
	}
	sellerID := testutil.CreateTestUserID(t, "provider")
	order := models.Order{
		ID:            uuid.New(),
		BuyerID:       session.UserID,
		SellerID:      sellerID,
		ListingID:     testutil.CreateTestListing(t, sellerID).ID,
		BandwidthGB:   1,
		PricePerGB:    1,
		TotalPrice:    1,
		Status:        models.OrderStatusActive,
		SessionID:     &sessionID,
		EscrowPDA:     "EscrowPDA111111111111111111111111111",
		PaymentMethod: "solana_escrow",
	}
	if err := createOrderWithoutFKs(&order); err != nil {
		t.Fatalf("order: %v", err)
	}

	skip, refuse, reason := evaluateEscrowCustodialGate(session)
	if !skip || refuse || reason != "order_escrow_pda" {
		t.Fatalf("expected skip order_escrow_pda, got skip=%v refuse=%v reason=%q", skip, refuse, reason)
	}
}

// With the flag off, an escrow-backed order must still skip the custodial debit;
// otherwise the buyer pays twice (escrow + balance_sol) and the provider is credited twice.
func TestEvaluateEscrowCustodialGate_FlagOffStillSkipsEscrowOrder(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_ESCROW_PDA", "false")
	testutil.SetupTestDB(t)

	sessionID := uuid.New()
	session := &models.Session{
		ID:     sessionID,
		UserID: testutil.CreateTestUserID(t, "buyer"),
		Type:   models.SessionUniversal,
		Status: models.SessionActive,
		Config: "{}",
	}
	if err := db.DB.Create(session).Error; err != nil {
		t.Fatalf("session: %v", err)
	}
	sellerID := testutil.CreateTestUserID(t, "provider")
	order := models.Order{
		ID:            uuid.New(),
		BuyerID:       session.UserID,
		SellerID:      sellerID,
		ListingID:     testutil.CreateTestListing(t, sellerID).ID,
		BandwidthGB:   1,
		PricePerGB:    1,
		TotalPrice:    1,
		Status:        models.OrderStatusActive,
		SessionID:     &sessionID,
		EscrowPDA:     "EscrowPDA222222222222222222222222222",
		PaymentMethod: "solana_escrow",
	}
	if err := createOrderWithoutFKs(&order); err != nil {
		t.Fatalf("order: %v", err)
	}

	skip, refuse, reason := evaluateEscrowCustodialGate(session)
	if !skip || refuse || reason != "order_escrow_pda" {
		t.Fatalf("expected skip order_escrow_pda with flag off, got skip=%v refuse=%v reason=%q", skip, refuse, reason)
	}

	// A PAYG session (no order) still falls through to custodial settle.
	payg := &models.Session{ID: uuid.New()}
	if skip, refuse, _ := evaluateEscrowCustodialGate(payg); skip || refuse {
		t.Fatalf("expected PAYG session to fall through, got skip=%v refuse=%v", skip, refuse)
	}
}

func TestEvaluateEscrowCustodialGate_MarketplaceOrderMissingPDARefuses(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_ESCROW_PDA", "true")
	testutil.SetupTestDB(t)

	sessionID := uuid.New()
	session := &models.Session{
		ID:     sessionID,
		UserID: testutil.CreateTestUserID(t, "buyer"),
		Type:   models.SessionUniversal,
		Status: models.SessionActive,
		Config: "{}",
	}
	if err := db.DB.Create(session).Error; err != nil {
		t.Fatalf("session: %v", err)
	}
	sellerID := testutil.CreateTestUserID(t, "provider")
	order := models.Order{
		ID:          uuid.New(),
		BuyerID:     session.UserID,
		SellerID:    sellerID,
		ListingID:   testutil.CreateTestListing(t, sellerID).ID,
		BandwidthGB: 1,
		PricePerGB:  1,
		TotalPrice:  1,
		Status:      models.OrderStatusActive,
		SessionID:   &sessionID,
		EscrowPDA:   "",
		// PaymentMethod empty / non-escrow but order linked → refuse when flag on
	}
	if err := createOrderWithoutFKs(&order); err != nil {
		t.Fatalf("order: %v", err)
	}

	skip, refuse, reason := evaluateEscrowCustodialGate(session)
	if skip || !refuse || reason != "order_missing_escrow_pda" {
		t.Fatalf("expected refuse order_missing_escrow_pda, got skip=%v refuse=%v reason=%q", skip, refuse, reason)
	}
}
