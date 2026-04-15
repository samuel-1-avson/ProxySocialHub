package settlement

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	internalNats "github.com/proxyhubb/control-api/internal/nats"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	ReceiptCreatedSubject      = "proxy.settlement.v1.receipts.created"
	ManifestCoordinatedSubject = "proxy.settlement.v1.manifests.coordinated"
	defaultWindowSize          = 15 * time.Minute
	defaultReceiptSource       = "gateway_report"
)

type ReceiptCreatedEvent struct {
	ReceiptID  uuid.UUID `json:"receipt_id"`
	SessionID  uuid.UUID `json:"session_id"`
	ReportedAt time.Time `json:"reported_at"`
	Source     string    `json:"source"`
}

type ManifestCoordinatedEvent struct {
	ManifestID    uuid.UUID                       `json:"manifest_id"`
	ReceiptID     uuid.UUID                       `json:"receipt_id"`
	SessionID     uuid.UUID                       `json:"session_id"`
	WindowKey     string                          `json:"window_key"`
	Status        models.SettlementManifestStatus `json:"status"`
	CoordinatedAt time.Time                       `json:"coordinated_at"`
}

type Coordinator struct {
	aggregator *billing.Aggregator
	windowSize time.Duration
}

func NewCoordinator(aggregator *billing.Aggregator) *Coordinator {
	if aggregator == nil {
		aggregator = billing.NewAggregator()
	}
	return &Coordinator{
		aggregator: aggregator,
		windowSize: defaultWindowSize,
	}
}

func AppendUsageReceipt(sessionUsername string, sessionData *redisClient.SessionData, bytesUp, bytesDown int64, signature string, nonce uint64, source string, reportedAt time.Time) (*models.UsageReceipt, bool, error) {
	if sessionData == nil {
		return nil, false, fmt.Errorf("session data is required")
	}

	sessionID, err := uuid.Parse(sessionData.SessionID)
	if err != nil {
		return nil, false, fmt.Errorf("invalid session id %q: %w", sessionData.SessionID, err)
	}

	if reportedAt.IsZero() {
		reportedAt = time.Now().UTC()
	}
	if source == "" {
		source = defaultReceiptSource
	}

	receipt := models.UsageReceipt{
		SessionID:         sessionID,
		SessionUsername:   sessionUsername,
		UserRef:           sessionData.UserID,
		ProviderRef:       sessionData.ProviderID,
		ProviderNodeID:    sessionData.NodeID,
		RouteHost:         sessionData.NodeHost,
		BillingPricePerGB: sessionData.PricePerGB,
		BytesUp:           bytesUp,
		BytesDown:         bytesDown,
		TotalBytes:        bytesUp + bytesDown,
		Nonce:             nonce,
		Signature:         signature,
		Source:            source,
		Status:            models.UsageReceiptPending,
		ReportedAt:        reportedAt,
	}

	result := db.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "session_username"}, {Name: "nonce"}},
		DoNothing: true,
	}).Create(&receipt)
	if result.Error != nil {
		return nil, false, fmt.Errorf("create usage receipt: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		var existing models.UsageReceipt
		if err := db.DB.Where("session_username = ? AND nonce = ?", sessionUsername, nonce).First(&existing).Error; err != nil {
			return nil, false, fmt.Errorf("load existing usage receipt: %w", err)
		}
		return &existing, false, nil
	}

	return &receipt, true, nil
}

func PublishReceiptCreated(ctx context.Context, receipt *models.UsageReceipt) error {
	if receipt == nil {
		return fmt.Errorf("usage receipt is required")
	}
	if internalNats.JS == nil {
		return fmt.Errorf("nats not initialized")
	}

	return internalNats.Publish(ctx, ReceiptCreatedSubject, ReceiptCreatedEvent{
		ReceiptID:  receipt.ID,
		SessionID:  receipt.SessionID,
		ReportedAt: receipt.ReportedAt,
		Source:     receipt.Source,
	})
}

func (c *Coordinator) ProcessReceipt(ctx context.Context, receiptID uuid.UUID) error {
	if receiptID == uuid.Nil {
		return fmt.Errorf("receipt id is required")
	}

	var receipt models.UsageReceipt
	if err := db.DB.First(&receipt, "id = ?", receiptID).Error; err != nil {
		return fmt.Errorf("load usage receipt: %w", err)
	}
	if receipt.Status == models.UsageReceiptAggregated || receipt.Status == models.UsageReceiptSettled {
		return nil
	}

	if _, err := c.aggregator.AggregateReceipt(&receipt); err != nil {
		errText := err.Error()
		_ = db.DB.Model(&models.UsageReceipt{}).
			Where("id = ?", receipt.ID).
			Updates(map[string]interface{}{"status": models.UsageReceiptFailed, "last_error": errText}).Error
		return fmt.Errorf("aggregate usage receipt: %w", err)
	}

	now := time.Now().UTC()
	var manifest models.SettlementManifest
	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		var locked models.UsageReceipt
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&locked, "id = ?", receiptID).Error; err != nil {
			return err
		}
		if locked.Status == models.UsageReceiptAggregated || locked.Status == models.UsageReceiptSettled {
			return nil
		}

		coordinatedManifest, err := c.coordinateManifest(tx, &locked, now)
		if err != nil {
			return err
		}
		manifest = *coordinatedManifest

		return tx.Model(&models.UsageReceipt{}).
			Where("id = ?", locked.ID).
			Updates(map[string]interface{}{
				"status":        models.UsageReceiptAggregated,
				"manifest_id":   coordinatedManifest.ID,
				"aggregated_at": now,
				"last_error":    nil,
			}).Error
	}); err != nil {
		return fmt.Errorf("coordinate usage receipt: %w", err)
	}

	if manifest.ID != uuid.Nil && internalNats.JS != nil {
		if err := internalNats.Publish(ctx, ManifestCoordinatedSubject, ManifestCoordinatedEvent{
			ManifestID:    manifest.ID,
			ReceiptID:     receiptID,
			SessionID:     manifest.SessionID,
			WindowKey:     manifest.WindowKey,
			Status:        manifest.Status,
			CoordinatedAt: now,
		}); err != nil {
			logging.Warn().Err(err).Str("receipt_id", receiptID.String()).Msg("Failed to publish settlement manifest event")
		}
	}

	return nil
}

func (c *Coordinator) coordinateManifest(tx *gorm.DB, receipt *models.UsageReceipt, now time.Time) (*models.SettlementManifest, error) {
	reportedAt := receipt.ReportedAt.UTC()
	if reportedAt.IsZero() {
		reportedAt = now
	}
	windowStart := reportedAt.Truncate(c.windowSize)
	windowEnd := windowStart.Add(c.windowSize)
	windowKey := fmt.Sprintf("%s:%s", receipt.SessionID.String(), windowStart.Format(time.RFC3339))

	manifest := models.SettlementManifest{
		WindowKey:       windowKey,
		SessionID:       receipt.SessionID,
		SessionUsername: receipt.SessionUsername,
		UserRef:         receipt.UserRef,
		ProviderRef:     receipt.ProviderRef,
		Status:          models.SettlementManifestOpen,
		WindowStartedAt: windowStart,
		WindowEndedAt:   windowEnd,
		LastReceiptAt:   reportedAt,
	}

	if err := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "window_key"}},
		DoNothing: true,
	}).Create(&manifest).Error; err != nil {
		return nil, fmt.Errorf("create settlement manifest: %w", err)
	}
	if manifest.ID == uuid.Nil {
		if err := tx.Where("window_key = ?", windowKey).First(&manifest).Error; err != nil {
			return nil, fmt.Errorf("load settlement manifest: %w", err)
		}
	}

	if err := tx.Model(&models.SettlementManifest{}).
		Where("id = ?", manifest.ID).
		Updates(map[string]interface{}{
			"session_username": receipt.SessionUsername,
			"user_ref":         receipt.UserRef,
			"provider_ref":     receipt.ProviderRef,
			"status":           models.SettlementManifestCoordinated,
			"receipt_count":    gorm.Expr("COALESCE(receipt_count, 0) + 1"),
			"total_bytes_up":   gorm.Expr("COALESCE(total_bytes_up, 0) + ?", receipt.BytesUp),
			"total_bytes_down": gorm.Expr("COALESCE(total_bytes_down, 0) + ?", receipt.BytesDown),
			"total_bytes":      gorm.Expr("COALESCE(total_bytes, 0) + ?", receipt.TotalBytes),
			"last_receipt_at":  reportedAt,
			"coordinated_at":   now,
			"last_error":       nil,
		}).Error; err != nil {
		return nil, fmt.Errorf("update settlement manifest: %w", err)
	}

	if err := tx.First(&manifest, "id = ?", manifest.ID).Error; err != nil {
		return nil, fmt.Errorf("reload settlement manifest: %w", err)
	}

	return &manifest, nil
}
