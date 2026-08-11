package worker

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/settlement"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	meteringSpillPollInterval = 10 * time.Second
	meteringSpillBatchSize    = 25
	meteringSpillSourceTag    = "metering_spill"
)

// StartMeteringSpillDrainWorker promotes Redis-failure spill rows into usage_receipts (EV-05 lite).
func StartMeteringSpillDrainWorker(ctx context.Context) {
	GoSupervised("MeteringSpillDrainWorker", 5*time.Second, func() {
		runMeteringSpillDrainWorker(ctx)
	})
}

func runMeteringSpillDrainWorker(ctx context.Context) {
	ticker := time.NewTicker(meteringSpillPollInterval)
	defer ticker.Stop()

	logging.Info().Msg("Metering spill drain worker started")
	drainMeteringSpillQueue(ctx)

	for {
		select {
		case <-ctx.Done():
			logging.Info().Msg("Metering spill drain worker shutting down")
			return
		case <-ticker.C:
			drainMeteringSpillQueue(ctx)
		}
	}
}

func drainMeteringSpillQueue(ctx context.Context) {
	if db.DB == nil {
		return
	}

	// Reclaim rows left in draining (crash mid-drain). Dedup on receipt nonce makes
	// a rare double-attempt safe.
	_ = db.DB.Model(&models.MeteringWalSpill{}).
		Where("status = ?", models.MeteringWalSpillDraining).
		Update("status", models.MeteringWalSpillPending).Error

	pending, err := countPendingMeteringSpills()
	if err == nil && pending > 0 {
		logging.Info().Int64("pending", pending).Msg("metering spill backlog")
	}

	aggregator := billing.NewAggregator()
	coordinator := settlement.NewCoordinator(aggregator)

	for i := 0; i < meteringSpillBatchSize; i++ {
		row, claimed, err := claimNextMeteringSpill()
		if err != nil {
			logging.Warn().Err(err).Msg("metering spill: claim failed")
			return
		}
		if !claimed {
			return
		}
		if err := processMeteringSpill(ctx, coordinator, row); err != nil {
			logging.Warn().Err(err).Str("spill_id", row.ID.String()).Msg("metering spill: drain failed")
		}
	}
}

func countPendingMeteringSpills() (int64, error) {
	var n int64
	err := db.DB.Model(&models.MeteringWalSpill{}).
		Where("status = ?", models.MeteringWalSpillPending).
		Count(&n).Error
	return n, err
}

func claimNextMeteringSpill() (*models.MeteringWalSpill, bool, error) {
	var row models.MeteringWalSpill
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		q := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("status = ?", models.MeteringWalSpillPending).
			Order("created_at ASC")
		if err := q.First(&row).Error; err != nil {
			return err
		}
		return tx.Model(&row).Updates(map[string]interface{}{
			"status": models.MeteringWalSpillDraining,
			"error":  nil,
		}).Error
	})
	if err == gorm.ErrRecordNotFound {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return &row, true, nil
}

func processMeteringSpill(ctx context.Context, coordinator *settlement.Coordinator, row *models.MeteringWalSpill) error {
	if row.BytesUp+row.BytesDown <= 0 {
		return markMeteringSpill(row.ID, models.MeteringWalSpillDrained, nil)
	}

	sessionData, err := resolveSpillSession(row.SessionUsername)
	if err != nil {
		msg := err.Error()
		_ = markMeteringSpill(row.ID, models.MeteringWalSpillFailed, &msg)
		return err
	}

	nonce := spillNonce(row)
	sig := fmt.Sprintf("spill:%s", row.ID.String())
	receipt, created, err := settlement.AppendUsageReceipt(
		row.SessionUsername,
		sessionData,
		row.BytesUp,
		row.BytesDown,
		sig,
		nonce,
		meteringSpillSourceTag,
		row.CreatedAt.UTC(),
	)
	if err != nil {
		msg := err.Error()
		_ = markMeteringSpill(row.ID, models.MeteringWalSpillFailed, &msg)
		return err
	}

	if created {
		if err := settlement.PublishReceiptCreated(ctx, receipt); err != nil {
			if err := coordinator.ProcessReceipt(ctx, receipt.ID); err != nil {
				logging.Warn().Err(err).Str("receipt_id", receipt.ID.String()).Msg("metering spill: coordinate failed")
			}
		}
		total := row.BytesUp + row.BytesDown
		if err := redisClient.IncrementUsage(row.SessionUsername, total); err != nil {
			logging.Warn().Err(err).Str("session", row.SessionUsername).Msg("metering spill: redis usage increment failed")
		}
		if sessionData.ProviderID != "" && sessionData.UserID != "" {
			_ = redisClient.IncrementProviderUsage(sessionData.ProviderID, sessionData.UserID, total)
		}
	}

	return markMeteringSpill(row.ID, models.MeteringWalSpillDrained, nil)
}

func resolveSpillSession(sessionUsername string) (*redisClient.SessionData, error) {
	if data, err := redisClient.GetSession(sessionUsername); err == nil && data != nil {
		return data, nil
	}

	var sess models.Session
	if err := db.DB.Where("credentials_user = ? AND deleted_at IS NULL", sessionUsername).
		Order("created_at DESC").
		First(&sess).Error; err != nil {
		return nil, fmt.Errorf("session %q not in Redis or PG: %w", sessionUsername, err)
	}

	providerID := ""
	nodeID := ""
	if sess.NodeID != nil {
		nodeID = sess.NodeID.String()
	}
	listingID := ""
	price := 0.0
	if sess.ListingID != nil {
		listingID = sess.ListingID.String()
		var listing models.ProxyListing
		if err := db.DB.Where("id = ?", *sess.ListingID).First(&listing).Error; err == nil {
			providerID = listing.SellerID.String()
			price = listing.PricePerGB
		}
	}

	return &redisClient.SessionData{
		UserID:         sess.UserID.String(),
		SessionID:      sess.ID.String(),
		ProviderID:     providerID,
		Type:           string(sess.Type),
		Status:         string(sess.Status),
		BandwidthLimit: sess.BandwidthLimit,
		ListingID:      listingID,
		NodeID:         nodeID,
		PricePerGB:     price,
		CreatedAt:      sess.CreatedAt,
	}, nil
}

// spillNonce reserves a high-bit namespace so spill receipts never collide with
// edge monotonic metering:seq values. Must fit PostgreSQL BIGINT (signed int64).
func spillNonce(row *models.MeteringWalSpill) uint64 {
	sum := sha256.Sum256([]byte("metering_spill:" + row.ID.String()))
	n := binary.BigEndian.Uint64(sum[:8])
	return (n & 0x0FFFFFFFFFFFFFFF) | 0x7000000000000000
}

func markMeteringSpill(id uuid.UUID, status models.MeteringWalSpillStatus, errMsg *string) error {
	updates := map[string]interface{}{
		"status": status,
		"error":  errMsg,
	}
	if status == models.MeteringWalSpillDrained {
		now := time.Now().UTC()
		updates["drained_at"] = now
		updates["error"] = nil
	}
	return db.DB.Model(&models.MeteringWalSpill{}).Where("id = ?", id).Updates(updates).Error
}
