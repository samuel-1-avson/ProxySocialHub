// Package fsm owns validated order status writes (Phase 3B-2).
// Call sites should prefer TransitionOrder over ad-hoc status Updates/Save.
//
// DB CHECK on orders.status remains an optional follow-up after call sites converge (3B-3).
package fsm

import (
	"fmt"
	"time"

	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// TransitionOrder validates from→to against models.CanTransitionOrderStatus, then
// persists status (and optional extra columns) in one Updates call.
// On success, order.Status is updated in memory to match the DB write.
//
// Create defaults (inserting a new row with an initial status) should call
// AssertCreatableStatus before Create, or insert as pending and TransitionOrder.
func TransitionOrder(tx *gorm.DB, order *models.Order, to models.OrderStatus, extras map[string]interface{}) error {
	if order == nil {
		return fmt.Errorf("order is nil")
	}
	if err := models.ValidateOrderStatusTransition(order.Status, to); err != nil {
		return err
	}
	if tx == nil {
		return fmt.Errorf("tx is nil")
	}

	updates := map[string]interface{}{
		"status":     to,
		"updated_at": time.Now().UTC(),
	}
	for k, v := range extras {
		if k == "status" {
			continue
		}
		updates[k] = v
	}

	if err := tx.Model(order).Updates(updates).Error; err != nil {
		return fmt.Errorf("order status transition %s -> %s: %w", order.Status, to, err)
	}
	order.Status = to
	return nil
}

// AssertCreatableStatus ensures an initial create status is matrix-legal from empty.
func AssertCreatableStatus(status models.OrderStatus) error {
	return models.ValidateOrderStatusTransition("", status)
}
