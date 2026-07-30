// Package fsm owns validated order status writes (Phase 3B-2+).
// Call sites should prefer TransitionOrder over ad-hoc status Updates/Save.
//
// DB CHECK on orders.status remains an optional follow-up.
package fsm

import (
	"fmt"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

var (
	orderStatusTransitionsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "proxyhubb_order_status_transitions_total",
			Help: "Order status transition attempts by result, from, to, and source.",
		},
		[]string{"result", "from", "to", "source"},
	)
	orderStatusTransitionDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "proxyhubb_order_status_transition_duration_seconds",
			Help:    "Wall time spent validating and persisting an order status transition.",
			Buckets: []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1},
		},
		[]string{"result", "source"},
	)
)

func labelStatus(s models.OrderStatus) string {
	if s == "" {
		return "empty"
	}
	return string(s)
}

func normalizeSource(source string) string {
	if source == "" {
		return "unspecified"
	}
	return source
}

func observe(result string, from, to models.OrderStatus, source string, started time.Time) {
	src := normalizeSource(source)
	orderStatusTransitionsTotal.WithLabelValues(result, labelStatus(from), labelStatus(to), src).Inc()
	orderStatusTransitionDuration.WithLabelValues(result, src).Observe(time.Since(started).Seconds())
}

// Validate checks from→to and records metrics/logs on rejection (no DB write).
// Use before side effects (on-chain settle, dispute create); TransitionOrder also validates.
func Validate(from, to models.OrderStatus, source string) error {
	started := time.Now()
	if err := models.ValidateOrderStatusTransition(from, to); err != nil {
		observe("invalid", from, to, source, started)
		logging.Warn().
			Err(err).
			Str("from", labelStatus(from)).
			Str("to", labelStatus(to)).
			Str("source", normalizeSource(source)).
			Msg("order status transition rejected")
		return err
	}
	return nil
}

// TransitionOrder validates from→to against models.CanTransitionOrderStatus, then
// persists status (and optional extra columns) in one Updates call.
// On success, order.Status is updated in memory to match the DB write.
//
// Create defaults (inserting a new row with an initial status) should call
// AssertCreatableStatus before Create, or insert as pending and TransitionOrder.
func TransitionOrder(tx *gorm.DB, order *models.Order, to models.OrderStatus, source string, extras map[string]interface{}) error {
	started := time.Now()
	if order == nil {
		observe("invalid", "", to, source, started)
		err := fmt.Errorf("order is nil")
		logging.Warn().Err(err).Str("source", normalizeSource(source)).Msg("order status transition rejected")
		return err
	}
	from := order.Status
	if err := Validate(from, to, source); err != nil {
		// Validate already observed + logged
		return err
	}
	if tx == nil {
		observe("invalid", from, to, source, started)
		err := fmt.Errorf("tx is nil")
		logging.Warn().
			Err(err).
			Str("from", labelStatus(from)).
			Str("to", labelStatus(to)).
			Str("source", normalizeSource(source)).
			Msg("order status transition rejected")
		return err
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
		observe("db_error", from, to, source, started)
		logging.Error(err).
			Str("from", labelStatus(from)).
			Str("to", labelStatus(to)).
			Str("source", normalizeSource(source)).
			Str("order_id", order.ID.String()).
			Msg("order status transition DB write failed")
		return fmt.Errorf("order status transition %s -> %s: %w", from, to, err)
	}
	order.Status = to
	observe("ok", from, to, source, started)
	return nil
}

// AssertCreatableStatus ensures an initial create status is matrix-legal from empty.
func AssertCreatableStatus(status models.OrderStatus, source string) error {
	return Validate("", status, source)
}
