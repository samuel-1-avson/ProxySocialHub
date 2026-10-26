package billing

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/sessionintent"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// providerPayoutThresholdSOL is the minimum accrued balance before a payout is queued.
// Note: Actual on-chain transfer happens via batch processing for efficiency.
const providerPayoutThresholdSOL = 0.05

// P3-13: Circuit breaker — prevents thread saturation when Solana RPC is degraded.
// After cbMaxFailures consecutive failures inside a cbWindow window the worker
// pauses for cbPauseDuration before resuming.
const (
	cbMaxFailures   = 3
	cbWindow        = 60 * time.Second
	cbPauseDuration = 5 * time.Minute
)

const cbRedisKey = "circuit:payout:state"

type circuitBreaker struct {
	mu          sync.Mutex
	failures    []time.Time // timestamps of recent failures
	pausedUntil time.Time
}

var settlementCB = &circuitBreaker{}

// recordFailure adds a failure timestamp and returns true if the breaker just tripped.
// When tripped, the pause deadline is persisted to Redis so a service restart does
// not immediately retry into a degraded Solana RPC (4.1).
func (cb *circuitBreaker) recordFailure() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-cbWindow)
	fresh := cb.failures[:0]
	for _, t := range cb.failures {
		if t.After(cutoff) {
			fresh = append(fresh, t)
		}
	}
	fresh = append(fresh, now)
	cb.failures = fresh
	if len(cb.failures) >= cbMaxFailures {
		cb.pausedUntil = now.Add(cbPauseDuration)
		cb.failures = cb.failures[:0]
		// Persist to Redis — if the process restarts while tripped, isOpen() will
		// restore the deadline from Redis instead of resetting to zero.
		redis.Client.Set(context.Background(), cbRedisKey,
			cb.pausedUntil.Unix(), cbPauseDuration)
		return true
	}
	return false
}

// isOpen returns true when the breaker is tripped and settlement must be skipped.
// On first call after a restart, hydrates pausedUntil from Redis if the in-memory
// value is zero (4.1).
func (cb *circuitBreaker) isOpen() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	now := time.Now()
	// In-memory state is authoritative while the process is running.
	if cb.pausedUntil.After(now) {
		return true
	}
	// After a restart pausedUntil is zero — check Redis for a persisted deadline.
	if cb.pausedUntil.IsZero() {
		if val, err := redis.Client.Get(context.Background(), cbRedisKey).Int64(); err == nil {
			persisted := time.Unix(val, 0)
			if persisted.After(now) {
				cb.pausedUntil = persisted
				return true
			}
		}
	}
	return false
}

// recordSuccess resets the failure window and clears the Redis persisted state.
func (cb *circuitBreaker) recordSuccess() {
	cb.mu.Lock()
	cb.failures = cb.failures[:0]
	cb.pausedUntil = time.Time{} // zero so isOpen re-checks Redis next time if needed
	cb.mu.Unlock()
	redis.Client.Del(context.Background(), cbRedisKey)
}

// globalBatchProcessor is the singleton batch payout processor
var globalBatchProcessor *BatchPayoutProcessor

// InitBatchProcessor initializes the batch payout processor
func InitBatchProcessor(sendFunc func(ctx context.Context, recipient string, amountSOL float64) error,
	batchFunc func(ctx context.Context, items []models.BatchPayoutItem) (string, error)) {
	config := models.DefaultBatchConfig()
	globalBatchProcessor = NewBatchPayoutProcessor(config, sendFunc, batchFunc)
}

// GetBatchProcessor returns the global batch processor instance
func GetBatchProcessor() *BatchPayoutProcessor {
	return globalBatchProcessor
}

// StartSettlementWorker starts the background jobs
func StartSettlementWorker() {
	// Start settlement worker
	go func() {
		ticker := time.NewTicker(1 * time.Hour) // Run every hour
		for {
			select {
			case <-ticker.C:
				SettleUsage()
			}
		}
	}()

	// Start batch payout processor if initialized
	if globalBatchProcessor != nil {
		globalBatchProcessor.Start(context.Background())
		logging.Info().Msg("Batch payout processor started")
	}
}

const settleLockTTL = 2 * time.Minute


// SettleUsage moves pending usage from Redis to SQL Ledger
func SettleUsage() {
	// P3-13: Respect circuit breaker — skip the entire run if the breaker is open.
	if settlementCB.isOpen() {
		logging.Warn().Msg("Billing settlement skipped: circuit breaker is open (Solana RPC degraded)")
		return
	}

	logging.Info().Msg("Starting billing settlement...")

	// W-16: recover bytes from claims whose settler died mid-flight.
	sweepStaleMeteringClaims()

	// 1. Scan all pending sessions. Bytes are claimed atomically AFTER
	// the lock, inside settleSession - never read before it (W-16).
	iter := redis.Client.Scan(context.Background(), 0, "billing:session:*:pending", 0).Iterator()

	count := 0
	for iter.Next(context.Background()) {
		key := iter.Val()
		sessionID := strings.TrimPrefix(key, "billing:session:")
		sessionID = strings.TrimSuffix(sessionID, ":pending")

		token, ok := acquireSettleLock(sessionID)
		if !ok {
			continue
		}
		err := settleSession(sessionID, 0, key)
		releaseSettleLock(sessionID, token)
		if err != nil {
			logging.Error(err).Str("session_id", sessionID).Msg("Failed to settle session")
		} else {
			count++
		}
	}

	logging.Info().Int("settled_sessions", count).Msg("Billing settlement complete")
}

// P1-19: sessionID is the UUID primary key extracted from the Redis key.
// P2-06: Orchestrates three focused helpers — computeSessionCost,
// debitBuyerWallet, creditProviderWallet — each independently testable.
func settleSession(sessionID string, totalBytes int64, redisKey string) error {
	var session models.Session
	if err := db.DB.Preload("Listing").Where("id = ?", sessionID).First(&session).Error; err != nil {
		return err
	}

	if skip, refuse, reason := evaluateEscrowCustodialGate(&session); refuse {
		return fmt.Errorf("PROXYHUB_REQUIRE_ESCROW_PDA: refusing custodial settle for session %s (%s)", sessionID, reason)
	} else if skip {
		logging.Info().
			Str("session_id", sessionID).
			Str("reason", reason).
			Msg("billing: skipping custodial settle for escrow-backed marketplace session")
		if err := consumeExternalClaim(sessionID, redisKey, totalBytes); err != nil {
			return err
		}
		if err := markSettlementArtifactsSettled(session.ID); err != nil {
			logging.Warn().Err(err).Str("session_id", session.ID.String()).Msg("Billing: failed to mark escrow session artifacts settled")
		}
		return nil
	}

	if skip, reason := shouldSettleOnChainSessionPDA(&session); skip {
		logging.Info().
			Str("session_id", sessionID).
			Str("reason", reason).
			Msg("billing: settling session escrow PDA on-chain (skip custodial)")
		claim, err := claimSessionUsage(sessionID, redisKey, totalBytes, 0)
		if err != nil {
			return err
		}
		claimedBytes := totalBytes
		if claim != nil {
			claimedBytes = claim.Bytes
		}
		if err := settleSessionEscrowOnChain(&session, claimedBytes); err != nil {
			requeueClaim(claim, err)
			logging.Error(err).Str("session_id", sessionID).Msg("billing: session escrow on-chain settle failed")
			return err
		}
		if claim != nil {
			now := time.Now().UTC()
			_ = db.DB.Model(&models.UsageMeteringClaim{}).
				Where("id = ? AND status = ?", claim.ID, models.MeteringClaimClaimed).
				Updates(map[string]interface{}{"status": models.MeteringClaimExternal, "settled_at": now}).Error
		}
		if err := markSettlementArtifactsSettled(session.ID); err != nil {
			logging.Warn().Err(err).Str("session_id", session.ID.String()).Msg("Billing: failed to mark session-pda artifacts settled")
		}
		markProviderEarningPaid(session.ID)
		return nil
	}

	if decentralization.RequireSessionPDAEnabled() {
		return fmt.Errorf("PROXYHUB_REQUIRE_SESSION_PDA: session %s has no session_pda; custodial balance_sol settle disabled", sessionID)
	}

	// Price pre-check on a non-destructive peek: on outage nothing is
	// claimed or deleted (P0-7 semantics preserved under W-16 claims).
	peekedBytes := peekPendingBytes(redisKey, totalBytes)
	solPrice := sessionSOLPrice(sessionID)
	_, peekUSD, _ := computeSessionCostLamportsAtPrice(&session, peekedBytes, solPrice)
	if peekedBytes > 0 && peekUSD > 0 && solPrice <= 0 {
		// W-17: a price outage is not RPC degradation - never trip the
		// settlement circuit breaker for it.
		logging.Error(ErrSOLPriceUnavailable).
			Str("session_id", sessionID).
			Int64("bytes", peekedBytes).
			Float64("cost_usd", peekUSD).
			Msg("ALERT: billing settlement deferred — SOL price unavailable (usage retained, not billed)")
		return fmt.Errorf("%w: session %s (%d bytes, $%.6f unbilled)", ErrSOLPriceUnavailable, sessionID, peekedBytes, peekUSD)
	}

	// W-16: durable claim. From here the claim row - not Redis - is the
	// metering evidence; every failure requeues from it.
	claim, err := claimSessionUsage(sessionID, redisKey, totalBytes, solPrice)
	if err != nil {
		return err
	}
	if claim == nil {
		return nil // nothing pending (raced or zero)
	}
	totalBytes = claim.Bytes
	if claim.SOLPriceUSD != nil && *claim.SOLPriceUSD > 0 {
		solPrice = *claim.SOLPriceUSD
	}
	costLamports, costUSD, costSOL := computeSessionCostLamportsAtPrice(&session, totalBytes, solPrice)

	// queuePayoutAfterCommit is set inside the tx and consumed after commit (FW-02).
	var queuePayoutAfterCommit uuid.UUID

	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		buyerWallet, err := debitBuyerWallet(tx, &session, totalBytes, costLamports, costSOL, costUSD)
		if err != nil {
			return err
		}

		shouldQueue, providerWalletID, err := creditProviderWallet(tx, &session, totalBytes, costLamports, costSOL)
		if err != nil {
			return err
		}
		if shouldQueue && session.Listing != nil {
			queuePayoutAfterCommit = session.Listing.SellerID
		}

		buyerDebit := costLamports
		providerCredit := int64(0)
		if providerWalletID != uuid.Nil {
			providerCredit = buyerDebit // full amount to provider in current model
		}
		desc := fmt.Sprintf("Usage settle %s", session.ID.String())
		// W-29: journal refs are namespaced per settlement EVENT (claim),
		// never the bare session id - (external_ref, entry_type) is unique.
		journalRef := "usage-settle:" + claim.ID.String()
		if err := models.PostUsageJournal(tx, buyerWallet, providerWalletID, buyerDebit, providerCredit, 0, journalRef, desc); err != nil {
			return err
		}

		// The claim settles in the SAME tx as the money (W-16).
		now := time.Now().UTC()
		res := tx.Model(&models.UsageMeteringClaim{}).
			Where("id = ? AND status = ?", claim.ID, models.MeteringClaimClaimed).
			Updates(map[string]interface{}{"status": models.MeteringClaimSettled, "settled_at": now})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return fmt.Errorf("metering claim %s no longer claimed (concurrent settle?)", claim.ID)
		}
		return nil
	}); err != nil {
		requeueClaim(claim, err)
		// W-17: business failures (buyer cannot pay / over limit) must
		// not trip the RPC circuit breaker for every other session.
		if isBusinessSettleFailure(err) {
			logging.Warn().Err(err).Str("session_id", sessionID).
				Msg("billing: business settlement failure (not counted toward circuit breaker); bytes requeued")
			return err
		}
		if tripped := settlementCB.recordFailure(); tripped {
			logging.Error(fmt.Errorf("circuit breaker tripped")).
				Str("session_id", sessionID).
				Dur("pause", cbPauseDuration).
				Msg("ALERT: billing settlement circuit breaker open — too many consecutive failures; settlement paused")
		}
		return err
	}

	settlementCB.recordSuccess()

	if err := markSettlementArtifactsSettled(session.ID); err != nil {
		logging.Warn().Err(err).Str("session_id", session.ID.String()).Msg("Billing: failed to mark settlement artifacts settled")
	}
	markProviderEarningPaid(session.ID)

	if queuePayoutAfterCommit != uuid.Nil {
		go queueProviderPayout(queuePayoutAfterCommit)
	}
	return nil
}

// isBusinessSettleFailure classifies buyer-side failures that say
// nothing about infrastructure health (W-17).
func isBusinessSettleFailure(err error) bool {
	if errors.Is(err, models.ErrInsufficientBalance) {
		return true
	}
	var limitErr *models.SpendingLimitError
	return errors.As(err, &limitErr)
}

// markProviderEarningPaid moves the session's provider_earnings row from pending to paid
// once the provider has been credited (custodial settle) or paid on chain (session
// escrow). recordProviderEarning only does bookkeeping now, so without this the row
// would stay pending and a claim would pay it a second time (BE-CRIT-02).
func markProviderEarningPaid(sessionID uuid.UUID) {
	now := time.Now().UTC()
	if err := db.DB.Model(&models.ProviderEarning{}).
		Where("session_id = ? AND status = ?", sessionID, "pending").
		Updates(map[string]interface{}{"status": "paid", "paid_at": now}).Error; err != nil {
		logging.Warn().Err(err).Str("session_id", sessionID.String()).Msg("Billing: failed to mark provider earning paid")
	}
}

// evaluateEscrowCustodialGate decides marketplace escrow settle behavior when
// PROXYHUB_REQUIRE_ESCROW_PDA is enabled.
//
//	skip=true  — order is on-chain escrow; do not touch balance_sol
//	refuse=true — marketplace order exists without PDA (or order lookup failed);
//	              never fall through to custodial debit
//	both false — no marketplace order (PAYG / other); continue to session-PDA or custodial
func evaluateEscrowCustodialGate(session *models.Session) (skip bool, refuse bool, reason string) {
	if !decentralization.RequireEscrowPDAEnabled() {
		return false, false, ""
	}
	if session == nil {
		return false, true, "nil_session"
	}
	var order models.Order
	err := db.DB.Select("id", "escrow_pda", "payment_method").
		Where("session_id = ?", session.ID).
		Order("updated_at DESC").
		First(&order).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Not a marketplace escrow session — let session-PDA / custodial paths decide.
			return false, false, ""
		}
		return false, true, "order_lookup_failed"
	}
	if order.PaymentMethod == "solana_escrow" || strings.TrimSpace(order.EscrowPDA) != "" {
		return true, false, "order_escrow_pda"
	}
	return false, true, "order_missing_escrow_pda"
}

// shouldSkipCustodialSettleForEscrow is kept for older call sites/tests; prefer evaluateEscrowCustodialGate.
func shouldSkipCustodialSettleForEscrow(session *models.Session) (bool, string) {
	skip, refuse, reason := evaluateEscrowCustodialGate(session)
	if refuse {
		return false, reason
	}
	return skip, reason
}

// shouldSettleOnChainSessionPDA is true when PAYG settlement should use SessionEscrow PDA.
func shouldSettleOnChainSessionPDA(session *models.Session) (bool, string) {
	if session == nil {
		return false, ""
	}
	if !decentralization.RequireSessionPDAEnabled() {
		// Still settle on-chain if the session was funded via session escrow,
		// even when the require flag is off (avoid double-debit).
		if session.PaymentMethod == "solana_session_escrow" || strings.TrimSpace(session.SessionPDA) != "" {
			return true, "session_escrow_pda"
		}
		return false, ""
	}
	if session.PaymentMethod == "solana_session_escrow" || strings.TrimSpace(session.SessionPDA) != "" {
		return true, "session_escrow_pda"
	}
	return false, ""
}

func settleSessionEscrowOnChain(session *models.Session, totalBytes int64) error {
	oracle := solana.GetOracleClient()
	if oracle == nil {
		return fmt.Errorf("oracle client not available")
	}
	buyer, err := sol.PublicKeyFromBase58(session.BuyerWallet)
	if err != nil {
		return fmt.Errorf("invalid buyer wallet: %w", err)
	}
	seller, err := sol.PublicKeyFromBase58(session.SellerWallet)
	if err != nil {
		return fmt.Errorf("invalid seller wallet: %w", err)
	}
	var sidBytes [16]byte
	copy(sidBytes[:], session.ID[:])
	bytesUsed := uint64(totalBytes)
	if bytesUsed == 0 && session.BytesUsed > 0 {
		bytesUsed = uint64(session.BytesUsed)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	_, err = oracle.SettleSessionEscrow(ctx, "billing.settle_session_pda", solana.SettleSessionEscrowParams{
		SessionID: sidBytes,
		Buyer:     buyer,
		Seller:    seller,
		BytesUsed: bytesUsed,
	})
	return err
}

func markSettlementArtifactsSettled(sessionID uuid.UUID) error {
	now := time.Now().UTC()
	return db.DB.Transaction(func(tx *gorm.DB) error {
		var session models.Session
		if err := tx.Select("id", "user_id", "listing_id", "node_id").First(&session, "id = ?", sessionID).Error; err != nil {
			return err
		}

		if err := tx.Model(&models.UsageReceipt{}).
			Where("session_id = ? AND status IN ?", sessionID, []models.UsageReceiptStatus{models.UsageReceiptPending, models.UsageReceiptAggregated, models.UsageReceiptFailed}).
			Updates(map[string]interface{}{
				"status":     models.UsageReceiptSettled,
				"settled_at": now,
				"last_error": nil,
			}).Error; err != nil {
			return err
		}

		if err := tx.Model(&models.SettlementManifest{}).
			Where("session_id = ? AND status IN ?", sessionID, []models.SettlementManifestStatus{models.SettlementManifestOpen, models.SettlementManifestCoordinated, models.SettlementManifestFailed}).
			Updates(map[string]interface{}{
				"status":     models.SettlementManifestSettled,
				"settled_at": now,
				"last_error": nil,
			}).Error; err != nil {
			return err
		}

		return advanceSessionIntentSettlementLifecycle(tx, &session, now)
	})
}

func advanceSessionIntentSettlementLifecycle(tx *gorm.DB, session *models.Session, now time.Time) error {
	record, err := findSessionIntentForSettlement(tx, session)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}

	updates := map[string]interface{}{}
	if sessionintent.CanAdvanceGatewayLifecycle(record.LifecycleState, models.SessionIntentLedgerCommitted) {
		sessionintent.ApplyLifecycleTransition(&record, updates, models.SessionIntentLedgerCommitted, now)
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
		sessionintent.ApplyLifecycleTransition(&record, updates, next, now)
		record.LifecycleState = next
	}

	if len(updates) == 0 {
		return nil
	}

	updates["updated_at"] = now
	return tx.Model(&models.SessionIntentRecord{}).
		Where("id = ?", record.ID).
		Updates(updates).Error
}

func findSessionIntentForSettlement(tx *gorm.DB, session *models.Session) (models.SessionIntentRecord, error) {
	buildQuery := func() *gorm.DB {
		query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("user_id = ?", session.UserID).
			Where("lifecycle_state IN ?", []models.SessionIntentLifecycle{
				models.SessionIntentActive,
				models.SessionIntentClosing,
				models.SessionIntentLedgerCommitted,
				models.SessionIntentBatched,
				models.SessionIntentChainCommitted,
			})

		if session.ListingID != nil {
			query = query.Where("listing_id = ?", *session.ListingID)
		} else {
			query = query.Where("listing_id IS NULL")
		}

		return query.Order("updated_at DESC").Order("created_at DESC")
	}

	if session.NodeID != nil {
		var exact models.SessionIntentRecord
		if err := buildQuery().Where("provider_node_id = ?", session.NodeID.String()).First(&exact).Error; err == nil {
			return exact, nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return models.SessionIntentRecord{}, err
		}
	}

	var record models.SessionIntentRecord
	err := buildQuery().First(&record).Error
	return record, err
}

// computeSessionCost returns (costSOL, costUSD) for totalBytes of consumption.
// Deprecated for money mutations — prefer computeSessionCostLamports (Sprint I).
func computeSessionCost(session *models.Session, totalBytes int64) (costSOL, costUSD float64) {
	_, costUSD, costSOL = computeSessionCostLamports(session, totalBytes)
	return
}

// computeSessionCostLamports returns lamports SoT plus display USD/SOL (Sprint I / DB-02 lite).
func computeSessionCostLamports(session *models.Session, totalBytes int64) (costLamports int64, costUSD, costSOL float64) {
	return computeSessionCostLamportsAtPrice(session, totalBytes, solPriceNow())
}

func computeSessionCostLamportsAtPrice(session *models.Session, totalBytes int64, solPriceUSD float64) (costLamports int64, costUSD, costSOL float64) {
	pricePerGB := 0.50 // USD/GB default
	if session.Listing != nil && session.Listing.PricePerGB > 0 {
		pricePerGB = session.Listing.PricePerGB
	}
	return CostFromBytesUSDAtSOLPrice(totalBytes, pricePerGB, solPriceUSD)
}

// sessionSOLPrice resolves the price for settlement: consumption-time
// snapshot first (P0-7), live feed second. Zero means unavailable.
func sessionSOLPrice(sessionID string) float64 {
	if redis.Client != nil {
		if v, err := redis.Client.Get(context.Background(), SessionPriceSnapshotKey(sessionID)).Float64(); err == nil && v > 0 {
			return v
		}
	}
	return solPriceNow()
}

// (P0-7 deleteSessionBillingKeys was removed by W-16: pending keys are
// consumed atomically by claimSessionUsage GETDEL, never deleted after.)

// debitBuyerWallet checks spending limits, deducts costLamports from the buyer's locked
// wallet, records spending, and writes the debit ledger entry — all within tx.
// Returns buyer wallet ID for PostUsageJournal (journal lines skipped here).
func debitBuyerWallet(tx *gorm.DB, session *models.Session, totalBytes int64, costLamports int64, costSOL, costUSD float64) (uuid.UUID, error) {
	var wallet models.Wallet
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("user_id = ?", session.UserID).First(&wallet).Error; err != nil {
		return uuid.Nil, err
	}

	if costLamports <= 0 {
		return wallet.ID, nil
	}

	if err := wallet.CheckSpendingLimit(tx, costSOL, models.SpendingUsage); err != nil {
		if spendingErr, ok := err.(*models.SpendingLimitError); ok {
			logging.Warn().
				Str("session_id", session.ID.String()).
				Str("limit_type", spendingErr.LimitType).
				Float64("limit", spendingErr.Limit).
				Float64("attempted", costSOL).
				Msg("Billing: spending limit would be exceeded")
			return uuid.Nil, fmt.Errorf("spending limit exceeded: %s limit of %.6f SOL: %w", spendingErr.LimitType, spendingErr.Limit, spendingErr)
		}
		return uuid.Nil, err
	}

	if !wallet.CanAffordLamports(costLamports) {
		logging.Warn().Str("session_id", session.ID.String()).
			Int64("need_lamports", costLamports).Int64("have_lamports", wallet.EffectiveBalanceLamports()).
			Msg("Billing: insufficient SOL balance")
		return uuid.Nil, fmt.Errorf("%w: session %s", models.ErrInsufficientBalance, session.ID)
	}

	if err := wallet.RecordSpending(tx, costSOL, models.SpendingUsage, session.ID.String()); err != nil {
		logging.Error(err).Str("session_id", session.ID.String()).Msg("Failed to record spending, continuing")
	}

	solPriceUSD := GetSOLPriceUSD()
	desc := fmt.Sprintf("Usage: %d bytes / $%.4f USD / %.6f SOL (@$%.2f/SOL)", totalBytes, costUSD, costSOL, solPriceUSD)
	if err := models.DebitWalletLockedLamports(tx, &wallet, costLamports, models.TransactionUsage, session.ID.String(), desc, models.LedgerOpts{JournalKind: "skip"}); err != nil {
		return uuid.Nil, err
	}
	return wallet.ID, nil
}

// creditProviderWallet credits the provider's wallet with costLamports inside tx and
// updates their quality score. Returns (true, providerWalletID, nil) when the balance crosses the
// payout threshold — caller must queue a batch payout after the tx commits (FW-02).
//
// Provider resolution order:
//  1. session.Listing.SellerID  — marketplace sessions (from-listing path)
//  2. node.ProviderUserID       — quick-start / instant sessions (node assigned, no listing)
func creditProviderWallet(tx *gorm.DB, session *models.Session, totalBytes int64, costLamports int64, costSOL float64) (bool, uuid.UUID, error) {
	var providerID uuid.UUID

	if session.Listing != nil && session.Listing.SellerID != uuid.Nil {
		providerID = session.Listing.SellerID
	} else if session.NodeID != nil {
		// No listing — resolve the node owner so the provider is still paid.
		var node models.Node
		if err := tx.Select("provider_user_id").First(&node, "id = ?", *session.NodeID).Error; err == nil {
			providerID = node.ProviderUserID
		}
	}

	if providerID == uuid.Nil {
		return false, uuid.Nil, nil
	}
	if costLamports <= 0 {
		return false, uuid.Nil, nil
	}

	// P0-01: FirstOrCreate inside the locked tx — never silently lose funds.
	var providerWallet models.Wallet
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("user_id = ?", providerID).
		FirstOrCreate(&providerWallet, models.Wallet{UserID: providerID}).Error; err != nil {
		return false, uuid.Nil, fmt.Errorf("billing: failed to lock/create provider wallet for %s: %w", providerID, err)
	}

	ref := session.ID.String() + ":provider"
	desc := fmt.Sprintf("Bandwidth earnings: %d bytes / %.6f SOL", totalBytes, costSOL)
	if err := models.CreditWalletLockedLamports(tx, &providerWallet, costLamports, "provider_earning", ref, desc, models.LedgerOpts{JournalKind: "skip"}); err != nil {
		return false, uuid.Nil, fmt.Errorf("billing: failed to credit provider wallet for %s: %w", providerID, err)
	}

	var score models.ProviderScore
	if err := tx.FirstOrCreate(&score, models.ProviderScore{ProviderID: providerID}).Error; err == nil {
		score.RecordSessionCompletion(true, totalBytes, getSessionLatency(session.ID))
		tx.Save(&score)
	}

	// W-10: auto-payout is opt-in and considers only the earnings-payable
	// sub-balance - buyer funds in the same wallet never trigger a sweep.
	shouldQueue := providerWallet.AutoPayoutEnabled &&
		providerWallet.PayableLamports() >= providerWallet.AutoPayoutThresholdOrDefault()
	return shouldQueue, providerWallet.ID, nil
}

// triggerProviderPayout sends accumulated SOL from treasury to provider's linked Solana wallet.
// Runs in a goroutine — errors are logged but do not affect billing settlement.
// C-3: pendingSOL parameter removed — the locked payoutAmount from the DB transaction is used
// for all on-chain operations so the deducted amount always matches what is sent.
func triggerProviderPayout(providerID uuid.UUID) {
	triggerProviderPayoutAmount(providerID, 0)
}

// triggerProviderPayoutAmount pays lamports of earnings-payable (0 = all
// payable) on-chain immediately. W-10: it can only ever sweep payable
// earnings, never the provider's buyer funds.
func triggerProviderPayoutAmount(providerID uuid.UUID, lamports int64) {
	ctx := context.Background()

	walletAddress, err := resolveProviderWallet(providerID)
	if err != nil {
		logging.Warn().Str("provider_id", providerID.String()).Err(err).Msg("Provider payout: no payable wallet found")
		return
	}

	var payoutLamports int64
	txErr := db.DB.Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", providerID).First(&wallet).Error; err != nil {
			return err
		}
		payoutLamports = lamports
		if payoutLamports <= 0 {
			payoutLamports = wallet.PayableLamports()
		}
		if payoutLamports <= 0 {
			return fmt.Errorf("no earnings payable for payout")
		}
		if wallet.PayableLamports() < payoutLamports {
			return fmt.Errorf("payable balance dropped below payout amount before payout")
		}
		ref := fmt.Sprintf("payout:%s:%s", providerID.String(), uuid.New().String())
		desc := fmt.Sprintf("On-chain payout to %s (%d lamports)", walletAddress, payoutLamports)
		return models.DebitEarningsPayable(tx, &wallet, payoutLamports, ref, desc)
	})
	if txErr != nil {
		logging.Error(txErr).Str("provider_id", providerID.String()).Msg("Provider payout: wallet deduction failed")
		return
	}
	payoutAmount := models.LamportsToSOL(uint64(payoutLamports))

	if err := sendSOLToWallet(ctx, walletAddress, payoutAmount); err != nil {
		errMsg := err.Error()
		now := time.Now()
		entry := models.PayoutRetryQueue{
			ProviderID:      providerID,
			WalletAddress:   walletAddress,
			AmountSOL:       payoutAmount,
			AttemptCount:    1,
			LastAttemptedAt: &now,
			NextRetryAt:     now.Add(2 * time.Minute),
			Status:          "pending",
			ErrorMessage:    &errMsg,
		}
		if dbErr := db.DB.Create(&entry).Error; dbErr != nil {
			restoreErr := db.DB.Transaction(func(tx *gorm.DB) error {
				var w models.Wallet
				if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
					Where("user_id = ?", providerID).First(&w).Error; err != nil {
					return err
				}
				ref := fmt.Sprintf("payout-restore:%s:%s", providerID.String(), uuid.New().String())
				desc := fmt.Sprintf("Restore after payout enqueue failure (%d lamports)", payoutLamports)
				return models.CreditEarningsPayableRestore(tx, &w, payoutLamports, ref, desc)
			})
			if restoreErr != nil {
				logging.Error(restoreErr).Str("provider_id", providerID.String()).Msg("Provider payout: enqueue failed and balance restore failed")
			} else {
				logging.Error(dbErr).Str("provider_id", providerID.String()).Msg("Provider payout: failed to enqueue retry — balance restored via ledger")
			}
		} else {
			logging.Error(err).Str("provider_id", providerID.String()).Str("retry_id", entry.ID.String()).Msg("Provider payout: on-chain transfer failed, queued for retry")
		}
		return
	}

	logging.Info().
		Str("provider_id", providerID.String()).
		Str("wallet", walletAddress).
		Float64("amount_sol", payoutAmount).
		Msg("Provider payout completed on-chain (devnet)")
}

// queueProviderPayout queues a provider payout for batch processing.
// This is the preferred method as it saves gas by batching multiple payouts.
// P0-1: the wallet debit and the PendingPayout intent row commit in ONE
// transaction, keyed by a per-payout UUID. There is no restore dance: any
// failure rolls the debit back together with the enqueue.
func queueProviderPayout(providerID uuid.UUID) {
	if _, _, err := QueueProviderPayoutAmount(providerID, 0); err != nil {
		logging.Error(err).Str("provider_id", providerID.String()).Msg("Provider payout: queue failed (no debit persisted)")
	}
}

// QueueProviderPayoutAmount atomically debits lamports of earnings-payable
// (0 = all payable) and enqueues the batch payout intent in ONE
// transaction (P0-1 atomicity, W-10 payable scoping). Used by opt-in
// auto-payout and by the manual claim endpoint. Large amounts route to
// the immediate on-chain path, which owns its own debit+send+retry
// bookkeeping over the same payable funds.
func QueueProviderPayoutAmount(providerID uuid.UUID, lamports int64) (uuid.UUID, int64, error) {
	walletAddress, err := resolveProviderWallet(providerID)
	if err != nil {
		return uuid.Nil, 0, fmt.Errorf("no payable wallet found: %w", err)
	}

	if globalBatchProcessor == nil {
		go triggerProviderPayoutAmount(providerID, lamports)
		return uuid.Nil, lamports, nil
	}

	// Peek payable for the immediate-path route; the tx re-validates.
	var peek models.Wallet
	if err := db.DB.Select("earnings_payable_lamports", "balance_lamports").Where("user_id = ?", providerID).First(&peek).Error; err == nil {
		routeLamports := lamports
		if routeLamports <= 0 {
			routeLamports = peek.PayableLamports()
		}
		if models.LamportsToSOL(uint64(routeLamports)) >= globalBatchProcessor.ImmediateThreshold() {
			go triggerProviderPayoutAmount(providerID, lamports)
			return uuid.Nil, routeLamports, nil
		}
	}

	payoutID := uuid.New()
	ledgerRef := fmt.Sprintf("payout-queue:%s:%s", providerID.String(), payoutID.String())
	var payoutLamports int64
	txErr := db.DB.Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", providerID).First(&wallet).Error; err != nil {
			return err
		}
		payoutLamports = lamports
		if payoutLamports <= 0 {
			payoutLamports = wallet.PayableLamports()
		}
		if payoutLamports <= 0 {
			return fmt.Errorf("no earnings payable for payout")
		}
		if wallet.PayableLamports() < payoutLamports {
			return fmt.Errorf("payable balance %d below requested payout %d", wallet.PayableLamports(), payoutLamports)
		}
		desc := fmt.Sprintf("Queued for batch payout to %s (%d lamports)", walletAddress, payoutLamports)
		if err := models.DebitEarningsPayable(tx, &wallet, payoutLamports, ledgerRef, desc); err != nil {
			return err
		}
		return globalBatchProcessor.EnqueuePayoutTx(tx, providerID, walletAddress, models.LamportsToSOL(uint64(payoutLamports)), payoutID.String())
	})
	if txErr != nil {
		return uuid.Nil, 0, txErr
	}

	logging.Info().
		Str("provider_id", providerID.String()).
		Str("payout_id", payoutID.String()).
		Int64("amount_lamports", payoutLamports).
		Msg("Provider payout queued for batch processing")
	return payoutID, payoutLamports, nil
}

// resolveProviderWallet returns the best payout address for a provider.
// Priority: primary verified linked Solana wallet → profile wallet_address.
func resolveProviderWallet(providerID uuid.UUID) (string, error) {
	// 1. Primary verified linked wallet (N-07)
	var linked models.LinkedWallet
	err := db.DB.Where(
		"user_id = ? AND chain = 'solana' AND is_primary = true AND verified = true AND deleted_at IS NULL",
		providerID,
	).First(&linked).Error
	if err == nil {
		return linked.Address, nil
	}

	// 2. Fall back to profile wallet_address
	var user models.User
	if err := db.DB.Select("wallet_address").Where("id = ?", providerID).First(&user).Error; err != nil {
		return "", fmt.Errorf("user not found: %w", err)
	}
	if user.WalletAddress == nil || *user.WalletAddress == "" {
		return "", fmt.Errorf("no linked Solana wallet configured")
	}
	return *user.WalletAddress, nil
}

// sendSOLToWallet transfers SOL from the oracle/treasury to a recipient Solana address.
func sendSOLToWallet(ctx context.Context, recipientAddress string, amountSOL float64) error {
	// Import is done via the solana package — use the global oracle client
	// We avoid import cycles by keeping this as a thin wrapper
	// The actual oracle client is registered in main.go via solana.InitOracleClient
	// Here we use a package-level function pointer set at startup.
	if globalSendSOL == nil {
		return fmt.Errorf("SOL transfer function not initialized")
	}
	return globalSendSOL(ctx, recipientAddress, amountSOL)
}

// globalSendSOL is set by main.go after the oracle client is initialized.
// This avoids an import cycle between billing and solana packages.
var globalSendSOL func(ctx context.Context, recipient string, amountSOL float64) error

// SetSOLTransferFunc registers the on-chain SOL transfer implementation.
// Must be called from main.go after initializing the oracle client.
func SetSOLTransferFunc(fn func(ctx context.Context, recipient string, amountSOL float64) error) {
	globalSendSOL = fn
}

// StartPayoutRetryWorker polls payout_retry_queue every 5 minutes and retries
// failed on-chain payouts with exponential backoff (max 8 attempts, then marks permanent failure).
func StartPayoutRetryWorker() {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			processPayoutRetries()
		}
	}()
}

func processPayoutRetries() {
	ctx := context.Background()
	var entries []models.PayoutRetryQueue
	if err := db.DB.
		Where("status = ? AND next_retry_at <= ?", "pending", time.Now()).
		Order("next_retry_at ASC").
		Limit(50).
		Find(&entries).Error; err != nil {
		logging.Error(err).Msg("Payout retry worker: failed to query retry queue")
		return
	}

	for _, entry := range entries {
		now := time.Now()
		err := sendSOLToWallet(ctx, entry.WalletAddress, entry.AmountSOL)

		update := map[string]interface{}{
			"attempt_count":     entry.AttemptCount + 1,
			"last_attempted_at": now,
			"updated_at":        now,
		}

		if err == nil {
			update["status"] = "succeeded"
			update["error_message"] = nil
			logging.Info().
				Str("retry_id", entry.ID.String()).
				Str("wallet", entry.WalletAddress).
				Float64("amount_sol", entry.AmountSOL).
				Int("attempt", entry.AttemptCount+1).
				Msg("Payout retry succeeded")
		} else {
			errMsg := err.Error()
			update["error_message"] = errMsg
			nextAttempt := entry.AttemptCount + 1
			if nextAttempt >= 8 {
				update["status"] = "failed_permanent"
				logging.Error(err).
					Str("retry_id", entry.ID.String()).
					Int("attempts", nextAttempt).
					Msg("Payout retry: permanent failure after max attempts — manual intervention required")
			} else {
				// Exponential backoff: 2^attempt minutes, capped at ~2h
				backoffMins := math.Pow(2, float64(nextAttempt))
				if backoffMins > 128 {
					backoffMins = 128
				}
				update["next_retry_at"] = now.Add(time.Duration(backoffMins) * time.Minute)
				logging.Warn().
					Str("retry_id", entry.ID.String()).
					Int("attempt", nextAttempt).
					Float64("backoff_minutes", backoffMins).
					Msg("Payout retry: attempt failed, will retry")
			}
		}

		if dbErr := db.DB.Model(&models.PayoutRetryQueue{}).Where("id = ?", entry.ID).Updates(update).Error; dbErr != nil {
			logging.Error(dbErr).Str("retry_id", entry.ID.String()).Msg("Payout retry: failed to update queue entry")
		}
	}
}

// getSessionLatency retrieves the average latency for a session from Redis or database
func getSessionLatency(sessionID uuid.UUID) float64 {
	// Try to get from Redis first
	ctx := context.Background()
	latencyKey := fmt.Sprintf("session:%s:latency", sessionID.String())

	if redis.Client != nil {
		latency, err := redis.Client.Get(ctx, latencyKey).Float64()
		if err == nil && latency > 0 {
			return latency
		}
	}

	// Fallback: query database for session metrics
	var metrics models.SessionMetrics
	if err := db.DB.Where("session_id = ?", sessionID).Order("created_at DESC").First(&metrics).Error; err == nil {
		return metrics.AvgLatencyMs
	}

	// Default fallback if no data available
	return 0
}
