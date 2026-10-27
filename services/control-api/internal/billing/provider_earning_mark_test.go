package billing

import (
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func seedEarning(t *testing.T, status string) models.ProviderEarning {
	t.Helper()
	e := models.ProviderEarning{
		ProviderUserID: uuid.New(),
		NodeID:         uuid.New(),
		SessionID:      uuid.New(),
		NetAmountSOL:   0.25,
		Status:         status,
	}
	if err := db.DB.Create(&e).Error; err != nil {
		t.Fatalf("seed earning: %v", err)
	}
	return e
}

func reloadEarning(t *testing.T, id uuid.UUID) models.ProviderEarning {
	t.Helper()
	var e models.ProviderEarning
	if err := db.DB.First(&e, "id = ?", id).Error; err != nil {
		t.Fatalf("reload earning: %v", err)
	}
	return e
}

// BE-CRIT-02: once billing has credited or paid a session, its earning row must leave
// "pending", otherwise a claim would pay it again.
func TestMarkProviderEarningPaid_FlipsOnlyPendingRows(t *testing.T) {
	testutil.SetupTestDB(t)

	pending := seedEarning(t, "pending")
	failed := seedEarning(t, "failed")
	other := seedEarning(t, "pending")

	markProviderEarningPaid(pending.SessionID)
	markProviderEarningPaid(failed.SessionID)

	if got := reloadEarning(t, pending.ID); got.Status != "paid" || got.PaidAt == nil {
		t.Fatalf("pending row: status %q paid_at %v, want paid with a timestamp", got.Status, got.PaidAt)
	}
	if got := reloadEarning(t, failed.ID); got.Status != "failed" {
		t.Fatalf("a failed row must stay failed, got %q", got.Status)
	}
	if got := reloadEarning(t, other.ID); got.Status != "pending" {
		t.Fatalf("another session's row must be untouched, got %q", got.Status)
	}

	// Idempotent.
	markProviderEarningPaid(pending.SessionID)
	if got := reloadEarning(t, pending.ID); got.Status != "paid" {
		t.Fatalf("second call changed the row: %q", got.Status)
	}
}
