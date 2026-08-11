package settlement

import (
	"context"
	"fmt"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/sessionintent"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const intentReceiptSource = "intent_gateway"
const paymentMethodSessionEscrow = "solana_session_escrow"

// AppendIntentUsageReceipt writes a durable metering receipt for a session intent.
// SessionID is the intent UUID; username is intent:<uuid> so it never collides with
// legacy Redis session usernames.
func AppendIntentUsageReceipt(
	record *models.SessionIntentRecord,
	bytesUp, bytesDown int64,
	nonce uint64,
	unitPriceUSD float64,
) (*models.UsageReceipt, bool, error) {
	if record == nil {
		return nil, false, fmt.Errorf("session intent is required")
	}
	if bytesUp == 0 && bytesDown == 0 {
		return nil, false, nil
	}
	if nonce == 0 {
		nonce = uint64(time.Now().UTC().UnixNano())
	}

	username := "intent:" + record.ID.String()
	priceSOL := 0.0
	if unitPriceUSD > 0 {
		priceSOL = billing.USDToSOL(unitPriceUSD)
	}

	receipt := models.UsageReceipt{
		SessionID:         record.ID,
		SessionUsername:   username,
		UserRef:           record.UserID.String(),
		ProviderRef:       record.ProviderNodeID,
		ProviderNodeID:    record.ProviderNodeID,
		RouteHost:         record.TargetHost,
		BillingPricePerGB: priceSOL,
		BytesUp:           bytesUp,
		BytesDown:         bytesDown,
		TotalBytes:        bytesUp + bytesDown,
		Nonce:             nonce,
		Source:            intentReceiptSource,
		Status:            models.UsageReceiptPending,
		ReportedAt:        time.Now().UTC(),
	}

	result := db.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "session_username"}, {Name: "nonce"}},
		DoNothing: true,
	}).Create(&receipt)
	if result.Error != nil {
		return nil, false, fmt.Errorf("create intent usage receipt: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		var existing models.UsageReceipt
		if err := db.DB.Where("session_username = ? AND nonce = ?", username, nonce).First(&existing).Error; err != nil {
			return nil, false, fmt.Errorf("load existing intent usage receipt: %w", err)
		}
		return &existing, false, nil
	}
	return &receipt, true, nil
}

func shouldSettleOnChainIntentPDA(record *models.SessionIntentRecord) bool {
	if record == nil {
		return false
	}
	if strings.EqualFold(strings.TrimSpace(record.PaymentMethod), paymentMethodSessionEscrow) &&
		strings.TrimSpace(record.SessionPDA) != "" {
		return true
	}
	return decentralization.RequireSessionPDAEnabled() && strings.TrimSpace(record.SessionPDA) != ""
}

func settleIntentEscrowOnChain(record *models.SessionIntentRecord, totalBytes int64) error {
	oracle := solana.GetOracleClient()
	if oracle == nil {
		return fmt.Errorf("oracle client not available")
	}
	buyer, err := sol.PublicKeyFromBase58(record.BuyerWallet)
	if err != nil {
		return fmt.Errorf("intent buyer wallet: %w", err)
	}
	seller, err := sol.PublicKeyFromBase58(record.SellerWallet)
	if err != nil {
		return fmt.Errorf("intent seller wallet: %w", err)
	}
	var sid [16]byte
	copy(sid[:], record.ID[:])
	bytesUsed := uint64(0)
	if totalBytes > 0 {
		bytesUsed = uint64(totalBytes)
	}
	sig, err := oracle.SettleSessionEscrow(context.Background(), "settlement.intent_pda", solana.SettleSessionEscrowParams{
		SessionID: sid,
		Buyer:     buyer,
		Seller:    seller,
		BytesUsed: bytesUsed,
	})
	if err != nil {
		return err
	}
	logging.Info().
		Str("intent_id", record.ID.String()).
		Str("tx", sig).
		Uint64("bytes_used", bytesUsed).
		Msg("intent: settled session escrow on-chain")
	return nil
}

// SettleSessionIntent settles metered intent usage.
// Prepaid SessionEscrow intents settle on-chain (no custodial balance_sol debit).
// Legacy intents debit/credit wallets and post one balanced usage journal.
func SettleSessionIntent(intentID uuid.UUID) error {
	if intentID == uuid.Nil {
		return fmt.Errorf("intent id is required")
	}

	var record models.SessionIntentRecord
	if err := db.DB.Preload("Listing").
		Where("id = ? AND deleted_at IS NULL", intentID).
		First(&record).Error; err != nil {
		return err
	}

	totalBytes := record.TotalBytesUp + record.TotalBytesDown
	if totalBytes <= 0 {
		return db.DB.Transaction(func(tx *gorm.DB) error {
			return advanceIntentToArchived(tx, &record, time.Now().UTC())
		})
	}

	if shouldSettleOnChainIntentPDA(&record) {
		if err := settleIntentEscrowOnChain(&record, totalBytes); err != nil {
			return err
		}
		return db.DB.Transaction(func(tx *gorm.DB) error {
			now := time.Now().UTC()
			if err := tx.Model(&models.UsageReceipt{}).
				Where("session_id = ? AND status IN ?", intentID, []models.UsageReceiptStatus{
					models.UsageReceiptPending,
					models.UsageReceiptAggregated,
					models.UsageReceiptFailed,
				}).
				Updates(map[string]interface{}{
					"status":     models.UsageReceiptSettled,
					"settled_at": now,
					"last_error": nil,
				}).Error; err != nil {
				return err
			}
			return advanceIntentToArchived(tx, &record, now)
		})
	}

	if decentralization.RequireSessionPDAEnabled() {
		return fmt.Errorf("PROXYHUB_REQUIRE_SESSION_PDA: intent %s has no funded session escrow PDA; custodial balance_sol settle disabled", intentID)
	}

	return db.DB.Transaction(func(tx *gorm.DB) error {
		var locked models.SessionIntentRecord
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Preload("Listing").
			Where("id = ? AND deleted_at IS NULL", intentID).
			First(&locked).Error; err != nil {
			return err
		}

		var unsettled int64
		if err := tx.Model(&models.UsageReceipt{}).
			Where("session_id = ? AND status IN ?", intentID, []models.UsageReceiptStatus{
				models.UsageReceiptPending,
				models.UsageReceiptAggregated,
				models.UsageReceiptFailed,
			}).
			Count(&unsettled).Error; err != nil {
			return err
		}
		if unsettled == 0 {
			var settledCount int64
			_ = tx.Model(&models.UsageReceipt{}).
				Where("session_id = ? AND status = ?", intentID, models.UsageReceiptSettled).
				Count(&settledCount).Error
			if settledCount > 0 {
				return advanceIntentToArchived(tx, &locked, time.Now().UTC())
			}
		}

		unitPriceUSD := locked.BillingPricePerGBUSD
		if unitPriceUSD <= 0 && locked.Listing != nil && locked.Listing.PricePerGB > 0 {
			unitPriceUSD = locked.Listing.PricePerGB
		}
		if unitPriceUSD <= 0 && locked.MaxPricePerGB > 0 {
			unitPriceUSD = locked.MaxPricePerGB
		}
		if unitPriceUSD <= 0 {
			unitPriceUSD = 0.99
		}

		costLamports, costUSD, costSOL := billing.CostFromBytesUSD(totalBytes, unitPriceUSD)
		now := time.Now().UTC()

		if costLamports > 0 {
			var wallet models.Wallet
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("user_id = ?", locked.UserID).First(&wallet).Error; err != nil {
				return fmt.Errorf("intent settle: buyer wallet: %w", err)
			}
			if err := wallet.CheckSpendingLimit(tx, costSOL, models.SpendingUsage); err != nil {
				return err
			}
			if !wallet.CanAffordLamports(costLamports) {
				return fmt.Errorf("insufficient SOL balance for intent usage")
			}
			_ = wallet.RecordSpending(tx, costSOL, models.SpendingUsage, locked.ID.String())
			desc := fmt.Sprintf("Intent usage: %d bytes / $%.4f USD / %.6f SOL", totalBytes, costUSD, costSOL)
			skip := models.LedgerOpts{JournalKind: "skip"}
			if err := models.DebitWalletLockedLamports(tx, &wallet, costLamports, models.TransactionUsage, locked.ID.String(), desc, skip); err != nil {
				return err
			}

			providerWalletID, providerCredit, err := creditIntentProviderSkipJournal(tx, &locked, totalBytes, costLamports, costSOL)
			if err != nil {
				logging.Error(err).Str("intent_id", locked.ID.String()).Msg("intent settle: provider credit failed")
				return err
			}
			buyerDebit := costLamports
			fee := buyerDebit - providerCredit
			if fee < 0 {
				fee = 0
			}
			if err := models.PostUsageJournal(tx, wallet.ID, providerWalletID, buyerDebit, providerCredit, fee, locked.ID.String(), desc); err != nil {
				return err
			}
		}

		if err := tx.Model(&models.UsageReceipt{}).
			Where("session_id = ? AND status IN ?", intentID, []models.UsageReceiptStatus{
				models.UsageReceiptPending,
				models.UsageReceiptAggregated,
				models.UsageReceiptFailed,
			}).
			Updates(map[string]interface{}{
				"status":     models.UsageReceiptSettled,
				"settled_at": now,
				"last_error": nil,
			}).Error; err != nil {
			return err
		}

		return advanceIntentToArchived(tx, &locked, now)
	})
}

func creditIntentProviderSkipJournal(tx *gorm.DB, record *models.SessionIntentRecord, totalBytes int64, costLamports int64, costSOL float64) (uuid.UUID, int64, error) {
	providerID := uuid.Nil
	if record.Listing != nil && record.Listing.SellerID != uuid.Nil {
		providerID = record.Listing.SellerID
	} else if record.ListingID != nil {
		var listing models.ProxyListing
		if err := tx.Select("seller_id").First(&listing, "id = ?", *record.ListingID).Error; err == nil {
			providerID = listing.SellerID
		}
	}
	if providerID == uuid.Nil && record.ProviderNodeID != "" {
		if nodeUUID, err := uuid.Parse(record.ProviderNodeID); err == nil {
			var pn models.ProviderNode
			if err := tx.Select("user_id").First(&pn, "id = ?", nodeUUID).Error; err == nil {
				providerID = pn.UserID
			} else {
				var node models.Node
				if err := tx.Select("provider_user_id").First(&node, "id = ?", nodeUUID).Error; err == nil {
					providerID = node.ProviderUserID
				}
			}
		}
	}
	if providerID == uuid.Nil || costLamports <= 0 {
		return uuid.Nil, 0, nil
	}

	var providerWallet models.Wallet
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("user_id = ?", providerID).
		FirstOrCreate(&providerWallet, models.Wallet{UserID: providerID}).Error; err != nil {
		return uuid.Nil, 0, err
	}
	ref := record.ID.String() + ":provider"
	desc := fmt.Sprintf("Intent bandwidth earnings: %d bytes / %.6f SOL", totalBytes, costSOL)
	if err := models.CreditWalletLockedLamports(tx, &providerWallet, costLamports, "provider_earning", ref, desc, models.LedgerOpts{JournalKind: "skip"}); err != nil {
		return uuid.Nil, 0, err
	}
	return providerWallet.ID, costLamports, nil
}

func advanceIntentToArchived(tx *gorm.DB, record *models.SessionIntentRecord, now time.Time) error {
	updates := map[string]interface{}{}
	if sessionintent.CanAdvanceGatewayLifecycle(record.LifecycleState, models.SessionIntentLedgerCommitted) {
		sessionintent.ApplyLifecycleTransition(record, updates, models.SessionIntentLedgerCommitted, now)
		record.LifecycleState = models.SessionIntentLedgerCommitted
	}
	for _, next := range []models.SessionIntentLifecycle{
		models.SessionIntentBatched,
		models.SessionIntentChainCommitted,
		models.SessionIntentArchived,
	} {
		if !sessionintent.CanAdvanceSettlementLifecycle(record.LifecycleState, next) {
			continue
		}
		sessionintent.ApplyLifecycleTransition(record, updates, next, now)
		record.LifecycleState = next
	}
	if len(updates) == 0 {
		return nil
	}
	updates["updated_at"] = now
	return tx.Model(&models.SessionIntentRecord{}).Where("id = ?", record.ID).Updates(updates).Error
}

// BestEffortPublishIntentReceipt publishes the receipt-created event when NATS is up.
func BestEffortPublishIntentReceipt(ctx context.Context, receipt *models.UsageReceipt) {
	if receipt == nil {
		return
	}
	if err := PublishReceiptCreated(ctx, receipt); err != nil {
		logging.Warn().Err(err).Str("receipt_id", receipt.ID.String()).Msg("intent receipt publish skipped")
	}
}
