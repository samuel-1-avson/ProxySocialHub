package worker

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type escrowReconciliationRecord struct {
	Source      string
	EventType   string
	EscrowPDA   string
	TxSignature string
	OrderID     *uuid.UUID
	Status      string
	Reason      string
	LastError   string
	Payload     interface{}
}

func recordEscrowReconciliation(params escrowReconciliationRecord) {
	if params.Source == "" || params.EventType == "" || params.EscrowPDA == "" {
		logging.Warn().
			Str("source", params.Source).
			Str("event_type", params.EventType).
			Str("escrow_pda", params.EscrowPDA).
			Msg("Skipping incomplete escrow reconciliation record")
		return
	}
	if params.Status == "" {
		params.Status = models.EscrowReconciliationStatusUnmatched
	}

	payload := datatypes.JSON([]byte("{}"))
	if params.Payload != nil {
		if bytes, err := json.Marshal(params.Payload); err == nil {
			payload = datatypes.JSON(bytes)
		}
	}

	now := time.Now()
	var existing models.EscrowReconciliationEvent
	err := db.DB.Where(
		"source = ? AND event_type = ? AND escrow_pda = ? AND tx_signature = ?",
		params.Source,
		params.EventType,
		params.EscrowPDA,
		params.TxSignature,
	).First(&existing).Error
	if err == nil {
		updates := map[string]interface{}{
			"status":       params.Status,
			"reason":       params.Reason,
			"last_error":   params.LastError,
			"payload":      payload,
			"last_seen_at": now,
			"attempts":     gorm.Expr("attempts + ?", 1),
			"updated_at":   now,
		}
		if params.OrderID != nil {
			updates["order_id"] = params.OrderID
		}
		if params.Status != models.EscrowReconciliationStatusResolved {
			updates["resolved_at"] = nil
		}
		if err := db.DB.Model(&existing).Updates(updates).Error; err != nil {
			logging.Error(err).Str("escrow_pda", params.EscrowPDA).Msg("Failed to update escrow reconciliation event")
		}
		return
	}
	if err != gorm.ErrRecordNotFound {
		logging.Error(err).Str("escrow_pda", params.EscrowPDA).Msg("Failed to load escrow reconciliation event")
		return
	}

	event := models.EscrowReconciliationEvent{
		Source:      params.Source,
		EventType:   params.EventType,
		EscrowPDA:   params.EscrowPDA,
		TxSignature: params.TxSignature,
		OrderID:     params.OrderID,
		Status:      params.Status,
		Reason:      params.Reason,
		LastError:   params.LastError,
		Attempts:    1,
		Payload:     payload,
		FirstSeenAt: now,
		LastSeenAt:  now,
	}
	if err := db.DB.Create(&event).Error; err != nil {
		logging.Error(err).Str("escrow_pda", params.EscrowPDA).Msg("Failed to create escrow reconciliation event")
	}
}

func markEscrowReconciliationResolved(escrowPDA, txSignature string, orderID uuid.UUID, reason string) {
	now := time.Now()
	query := db.DB.Model(&models.EscrowReconciliationEvent{}).
		Where("escrow_pda = ? AND status <> ?", escrowPDA, models.EscrowReconciliationStatusResolved)
	if txSignature != "" {
		query = query.Where("(tx_signature = ? OR tx_signature = '')", txSignature)
	}
	updates := map[string]interface{}{
		"status":       models.EscrowReconciliationStatusResolved,
		"reason":       reason,
		"last_error":   "",
		"order_id":     orderID,
		"last_seen_at": now,
		"resolved_at":  now,
		"updated_at":   now,
	}
	if err := query.Updates(updates).Error; err != nil {
		logging.Error(err).Str("escrow_pda", escrowPDA).Msg("Failed to resolve escrow reconciliation events")
	}
}
