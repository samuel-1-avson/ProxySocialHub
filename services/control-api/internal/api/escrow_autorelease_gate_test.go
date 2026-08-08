package api

import (
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
)

func TestAutoReleaseBlockReason_EscrowDisputed(t *testing.T) {
	escrow := &models.EscrowTransaction{ID: uuid.New(), Status: models.EscrowDisputed}
	order := &models.Order{ID: uuid.New(), Status: models.OrderStatusActive}
	if got := autoReleaseBlockReason(order, escrow); got != "escrow_disputed" {
		t.Fatalf("got %q want escrow_disputed", got)
	}
}

func TestAutoReleaseBlockReason_OrderDisputed(t *testing.T) {
	escrow := &models.EscrowTransaction{ID: uuid.New(), Status: models.EscrowHeld}
	order := &models.Order{ID: uuid.New(), Status: models.OrderStatusDisputed}
	if got := autoReleaseBlockReason(order, escrow); got != "order_disputed" {
		t.Fatalf("got %q want order_disputed", got)
	}
}
