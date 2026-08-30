package api

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/alerts"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/events"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/settlement"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
)

// PricePerGBSOL is a fallback display rate used only when no listing price is available.
// Actual billing uses per-listing prices from the marketplace (see billing/worker.go).
const PricePerGBSOL = 0.002 // SOL per GB (~$0.30 at ~$150/SOL fallback)

func RegisterUsageRoutes(r *gin.RouterGroup) {
	usage := r.Group("/usage")
	{
		// reportUsage is intentionally NOT on the user-JWT group — see RegisterGatewayUsageRoutes.
		usage.POST("/sign", signUsageClaim) // New endpoint for providers
		usage.GET("/session/:session_id", getSessionUsage)
		usage.GET("/me", getUserUsage) // Use authenticated user
		usage.GET("/settlement-receipts/:window_key", exportSettlementReceipt)
	}
}

// RegisterGatewayUsageRoutes mounts metering ingest behind X-Gateway-Auth.
// Edge gateway must call POST /v1/gateway/usage/report (not /v1/usage/report).
func RegisterGatewayUsageRoutes(r *gin.RouterGroup) {
	r.POST("/usage/report", reportUsage)
	r.POST("/metering/spill", spillMeteringWAL)
}

type meteringSpillRequest struct {
	SessionUsername string `json:"session_username" binding:"required"`
	BytesUp         int64  `json:"bytes_up"`
	BytesDown       int64  `json:"bytes_down"`
	Seq             *int64 `json:"seq"`
	Source          string `json:"source"`
}

// spillMeteringWAL accepts edge spill when Redis WAL/pending writes fail (EV-05 lite).
func spillMeteringWAL(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeHybridAsyncChain, "async_write", "source_of_truth")

	var req meteringSpillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.BytesUp < 0 || req.BytesDown < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bytes must be non-negative"})
		return
	}
	if req.BytesUp+req.BytesDown == 0 {
		c.JSON(http.StatusOK, gin.H{"status": "ignored", "reason": "zero_bytes"})
		return
	}
	source := strings.TrimSpace(req.Source)
	if source == "" {
		source = "redis_wal_fail"
	}
	if len(source) > 64 {
		source = source[:64]
	}

	row := models.MeteringWalSpill{
		SessionUsername: strings.TrimSpace(req.SessionUsername),
		BytesUp:         req.BytesUp,
		BytesDown:       req.BytesDown,
		Seq:             req.Seq,
		Status:          models.MeteringWalSpillPending,
		Source:          source,
	}
	if row.SessionUsername == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session_username required"})
		return
	}
	if err := db.DB.Create(&row).Error; err != nil {
		logging.Error(err).Str("session", row.SessionUsername).Msg("metering spill insert failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "spill insert failed"})
		return
	}
	logging.Info().
		Str("spill_id", row.ID.String()).
		Str("session_username", row.SessionUsername).
		Int64("bytes_up", row.BytesUp).
		Int64("bytes_down", row.BytesDown).
		Str("source", row.Source).
		Msg("metering WAL spill accepted")
	c.JSON(http.StatusAccepted, gin.H{
		"status":  "pending",
		"spill_id": row.ID.String(),
	})
}

type usageReportRequest struct {
	SessionUsername string `json:"session_username" binding:"required"`
	BytesUp         int64  `json:"bytes_up"`
	BytesDown       int64  `json:"bytes_down"`
	Signature       string `json:"signature"`
	Nonce           uint64 `json:"nonce"`
}

type batchUsageRequest struct {
	Reports []usageReportRequest `json:"reports" binding:"required"`
}

// reportUsage handles batch usage reports from the Gateway
func reportUsage(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeHybridAsyncChain, "async_write", "source_of_truth")

	var req batchUsageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// Try single report format
		var single usageReportRequest
		if err := c.ShouldBindJSON(&single); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		req.Reports = []usageReportRequest{single}
	}

	aggregator := billing.NewAggregator()
	coordinator := settlement.NewCoordinator(aggregator)
	processed := 0
	for _, report := range req.Reports {
		totalBytes := report.BytesUp + report.BytesDown

		// P2-14: Validate gateway signature BEFORE touching any counters.
		// If a signature is present and invalid, reject the report entirely —
		// do not update Redis or billing state.
		if err := aggregator.VerifySignature(
			report.SessionUsername,
			report.BytesUp, report.BytesDown,
			report.Nonce, report.Signature,
		); err != nil {
			logging.Warn().
				Str("session_username", report.SessionUsername).
				Err(err).
				Msg("Usage report rejected: invalid signature")
			continue
		}

		// Get session data from Redis (Source of Truth for Edge Gateway)
		sessionData, err := redisClient.GetSession(report.SessionUsername)
		if err != nil {
			logging.Warn().Err(err).Str("session_username", report.SessionUsername).Msg("Session data not found in Redis during reporting, skipping")
			continue
		}

		// P2-15: Cross-validate reported bytes against Redis state.
		// A single report claiming more bytes than the session's entire bandwidth
		// budget is a clear fraud signal — reject before touching any counters.
		if sessionData.BandwidthLimit > 0 {
			currentUsage, _ := redisClient.GetUsage(report.SessionUsername)
			// Reject if this single report alone exceeds the whole session limit,
			// or if adding it would push cumulative usage beyond 2× the limit.
			if totalBytes > sessionData.BandwidthLimit ||
				currentUsage+totalBytes > sessionData.BandwidthLimit*2 {
				logging.Warn().
					Str("session_username", report.SessionUsername).
					Int64("reported_bytes", totalBytes).
					Int64("current_usage", currentUsage).
					Int64("bandwidth_limit", sessionData.BandwidthLimit).
					Msg("Usage report rejected: claimed bytes exceed fraud threshold")
				continue
			}
		}

		receipt, created, err := settlement.AppendUsageReceipt(
			report.SessionUsername,
			sessionData,
			report.BytesUp,
			report.BytesDown,
			report.Signature,
			report.Nonce,
			"gateway_report",
			time.Now().UTC(),
		)
		if err != nil {
			logging.Error(err).Str("session", report.SessionUsername).Msg("Failed to append usage receipt")
			continue
		}
		if !created {
			logging.Debug().
				Str("session_username", report.SessionUsername).
				Uint64("nonce", report.Nonce).
				Msg("Usage receipt already exists, skipping duplicate metering report")
			continue
		}

		if err := settlement.PublishReceiptCreated(c.Request.Context(), receipt); err != nil {
			if err := coordinator.ProcessReceipt(c.Request.Context(), receipt.ID); err != nil {
				logging.Error(err).Str("receipt_id", receipt.ID.String()).Msg("Failed to coordinate usage receipt")
				continue
			}
		}

		// Update Redis real-time counter (Session based) after the durable receipt
		// has been accepted into the settlement pipeline.
		if err := redisClient.IncrementUsage(report.SessionUsername, totalBytes); err != nil {
			logging.Error(err).Str("session", report.SessionUsername).Msg("Failed to increment session usage in Redis")
		}

		// Auto-terminate session if bandwidth limit is exhausted
		if sessionData.BandwidthLimit > 0 {
			currentUsage, err := redisClient.GetUsage(report.SessionUsername)
			if err == nil && currentUsage >= sessionData.BandwidthLimit {
				go autoTerminateSessionBandwidth(sessionData.SessionID, report.SessionUsername)
			}
		}

		// Update Provider-Link counter (For Oracle claiming)
		if sessionData.ProviderID != "" && sessionData.UserID != "" {
			_ = redisClient.IncrementProviderUsage(sessionData.ProviderID, sessionData.UserID, totalBytes)
		}

		// Publish Billing Event (Async)
		// This decouples billing/analytics from the critical path
		sessionUsername := report.SessionUsername
		go func(data *redisClient.SessionData, username string, up, down int64) {
			defer func() {
				if r := recover(); r != nil {
					logging.Error(fmt.Errorf("panic in billing event: %v", r)).Msg("Recovered from panic in billing goroutine")
				}
			}()

			var signature []byte
			// FU-01: deterministic nonce — derived from sessionID + 5-minute window
			// so that retried reports within the same window produce the same nonce
			// and do not cause double-billing.
			window := time.Now().Truncate(5 * time.Minute).Unix()
			h := sha256.Sum256([]byte(fmt.Sprintf("%s:%d", data.SessionID, window)))
			nonce := binary.BigEndian.Uint64(h[:8])

			if signer := GetOracleSigner(); signer != nil {
				// We need ETH addresses for the Oracle.
				// Fallback to internal IDs if address is not stored (handled by signer validation)
				sig, err := signer.SignUsage(data.UserID, data.ProviderID,
					new(big.Int).SetUint64(uint64(up+down)),
					new(big.Int).SetUint64(nonce),
				)
				if err != nil {
					logging.Debug().Err(err).Msg("Skipped oracle signing (not in crypto mode or invalid addresses)")
				} else {
					signature = sig
				}
			}

			if q := GetEventQueue(); q != nil {
				_ = q.Publish(context.Background(), events.Event{
					ID:        fmt.Sprintf("evt_bw_%d_%s", time.Now().Unix(), data.SessionID),
					Type:      events.EventTypeBandwidthConsumed,
					Timestamp: time.Now(),
					Source:    "control-api",
					Payload: map[string]interface{}{
						"session_username": username,
						"user_id":          data.UserID,
						"provider_id":      data.ProviderID,
						"bytes_up":         up,
						"bytes_down":       down,
						"total_bytes":      up + down,
						"plan_type":        "pay_per_gb",
						"price_per_gb":     data.PricePerGB,
						"nonce":            nonce,
						"signature":        fmt.Sprintf("0x%x", signature),
					},
				})
			}
		}(sessionData, sessionUsername, report.BytesUp, report.BytesDown)

		processed++
	}

	c.JSON(http.StatusOK, gin.H{
		"processed": processed,
		"total":     len(req.Reports),
	})
}

// autoTerminateSessionBandwidth terminates a session that has exhausted its bandwidth limit.
//
// D-UP1: On-chain usage proof + escrow settlement wiring.
// After marking the session terminated in the DB the function:
//  1. Looks up the order linked to the session.
//  2. If the order has an on-chain EscrowPDA it submits a UsageProofRecord to
//     Solana (immutable audit trail) and then settles the escrow proportionally
//     so the provider is paid and the buyer receives the unused SOL refund.
//  3. Marks the order as completed in the DB.
//
// All Solana calls are fire-and-forget within a sub-goroutine to avoid
// blocking the metering flush path.
func autoTerminateSessionBandwidth(sessionID, credentialsUser string) {
	if sessionID == "" {
		return
	}

	now := time.Now()

	var session models.Session
	if err := db.DB.First(&session, "id = ?", sessionID).Error; err != nil {
		logging.Error(err).Str("session_id", sessionID).Msg("Failed to load bandwidth-exhausted session")
		return
	}
	if err := models.ValidateSessionStatusTransition(session.Status, models.SessionTerminated); err != nil {
		logging.Warn().Err(err).Str("session_id", sessionID).Msg("Skipping auto-termination for invalid session transition")
		return
	}

	if err := db.DB.Model(&session).
		Updates(map[string]interface{}{
			"status":   models.SessionTerminated,
			"end_time": now,
		}).Error; err != nil {
		logging.Error(err).Str("session_id", sessionID).Msg("Failed to auto-terminate bandwidth-exhausted session")
		return
	}
	logging.Info().Str("session_id", sessionID).Str("credentials_user", credentialsUser).Msg("Session auto-terminated: bandwidth limit exhausted")

	if _, escrowBacked, err := ensureUsageProofForSessionSettlement(session, now); err != nil {
		logging.Error(err).Str("session_id", sessionID).Msg("Failed to create usage proof for bandwidth-exhausted session")
	} else if escrowBacked {
		go anchorUsageProofAndSettle(sessionID, now)
	}
}

// ensureUsageProofForSessionSettlement materializes the durable usage proof for
// an escrow-backed session. It is intentionally synchronous so the API can return
// only after the audit record exists; on-chain anchoring still runs separately.
func ensureUsageProofForSessionSettlement(session models.Session, endedAt time.Time) (*models.UsageProof, bool, error) {
	var order models.Order
	if err := db.DB.Where("session_id = ?", session.ID).First(&order).Error; err != nil {
		return nil, false, nil
	}
	if order.EscrowPDA == "" {
		return nil, false, nil
	}

	var existing models.UsageProof
	if err := db.DB.Where("session_id = ? AND order_id = ?", session.ID, order.ID).First(&existing).Error; err == nil {
		return &existing, true, nil
	}

	totalBytes := session.BytesUsed
	if session.CredentialsUser != "" {
		if redisUsage, err := redisClient.GetUsage(session.CredentialsUser); err == nil && redisUsage > totalBytes {
			totalBytes = redisUsage
			session.BytesUsed = redisUsage
			_ = db.DB.Model(&models.Session{}).Where("id = ?", session.ID).Update("bytes_used", totalBytes).Error
		}
	}

	periodStart := session.StartTime
	if periodStart.IsZero() {
		periodStart = session.CreatedAt
	}
	if periodStart.IsZero() {
		periodStart = endedAt
	}
	if endedAt.IsZero() {
		endedAt = time.Now().UTC()
	}

	proof := models.UsageProof{
		SessionID:       session.ID,
		OrderID:         order.ID,
		BuyerWallet:     order.BuyerWallet,
		ProviderWallet:  order.SellerWallet,
		BytesUploaded:   0,
		BytesDownloaded: totalBytes,
		TotalBytes:      totalBytes,
		RequestCount:    0,
		PeriodStart:     periodStart,
		PeriodEnd:       endedAt,
		Status:          models.UsageProofSettlingConfidential,
	}
	proof.SetMessageHash()

	if err := db.DB.Create(&proof).Error; err != nil {
		return nil, true, err
	}
	return &proof, true, nil
}

// anchorUsageProofAndSettle submits a UsageProofRecord to Solana and then
// triggers escrow settlement for the session's linked order.
// It is called only when a session is terminated due to bandwidth exhaustion.
func anchorUsageProofAndSettle(sessionID string, terminatedAt time.Time) {
	oracle := solanaClient.GetOracleClient()
	if oracle == nil {
		logging.Warn().Str("session_id", sessionID).Msg("anchorUsageProofAndSettle: oracle not configured, skipping")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// 1. Find the order linked to this session.
	var order models.Order
	if err := db.DB.Where("session_id = ?", sessionID).First(&order).Error; err != nil {
		// No escrow order — standalone/PAYG session, nothing to settle on-chain.
		logging.Debug().Str("session_id", sessionID).Msg("anchorUsageProofAndSettle: no linked order, skipping")
		return
	}

	if order.EscrowPDA == "" {
		logging.Debug().Str("order_id", order.ID.String()).Msg("anchorUsageProofAndSettle: order has no EscrowPDA (PAYG), skipping")
		return
	}

	escrowPDA, err := sol.PublicKeyFromBase58(order.EscrowPDA)
	if err != nil {
		logging.Error(err).Str("escrow_pda", order.EscrowPDA).Msg("anchorUsageProofAndSettle: invalid EscrowPDA")
		return
	}

	// 2. Determine how many bytes were consumed (from DB session).
	var session models.Session
	if err := db.DB.Where("id = ?", sessionID).First(&session).Error; err != nil {
		logging.Error(err).Str("session_id", sessionID).Msg("anchorUsageProofAndSettle: session not found")
		return
	}

	totalBytes := session.BytesUsed
	if totalBytes <= 0 {
		logging.Warn().Str("session_id", sessionID).Msg("anchorUsageProofAndSettle: zero bytes used, skipping proof")
		return
	}

	// 3. Determine the next proof index for this escrow.
	var onChainCount int64
	db.DB.Model(&models.UsageProof{}).
		Where("order_id = ? AND status = ?", order.ID, models.UsageProofOnChain).
		Count(&onChainCount)
	proofIndex := uint32(onChainCount)

	// 4. Submit UsageProofRecord to Solana.
	// Use session.CreatedAt as the period start (session wall-clock start).
	periodStart := session.CreatedAt

	txHash, err := oracle.SubmitUsageProof(ctx, solanaClient.SubmitUsageProofParams{
		EscrowPDA:   escrowPDA,
		ProofIndex:  proofIndex,
		TotalBytes:  uint64(totalBytes),
		PeriodStart: periodStart.Unix(),
		PeriodEnd:   terminatedAt.Unix(),
	})
	if err != nil {
		logging.Error(err).Str("session_id", sessionID).Msg("anchorUsageProofAndSettle: SubmitUsageProof failed")
		alerts.Send(alerts.Critical, "Usage Proof Anchor Failed",
			fmt.Sprintf("session=%s order=%s escrow=%s err=%v", sessionID, order.ID, order.EscrowPDA, err))
		EnqueueEscrowSettleBytes(&order, "api.usage.anchor_and_settle.proof_rpc_fail", totalBytes)
		if decentralization.RequireUsageProofBeforeSettle() && !solanaClient.IsUsageProofAlreadyOnChain(err) {
			logging.Error(err).
				Str("session_id", sessionID).
				Str("order_id", order.ID.String()).
				Msg("anchorUsageProofAndSettle: refusing immediate settle; queued outbox retry")
			return
		}
		logging.Warn().Str("session_id", sessionID).Msg("anchorUsageProofAndSettle: continuing settle without new proof")
	} else {
		// Persist the on-chain reference in the usage_proofs table.
		db.DB.Model(&models.UsageProof{}).
			Where("session_id = ? AND order_id = ? AND status IN ?", session.ID, order.ID, []string{
				string(models.UsageProofPending),
				string(models.UsageProofSigned),
				string(models.UsageProofSettlingConfidential),
			}).
			Updates(map[string]interface{}{
				"status":           models.UsageProofOnChain,
				"on_chain_tx_hash": txHash,
				"on_chain_slot":    terminatedAt.Unix(),
			})
		logging.Info().Str("tx_hash", txHash).Str("session_id", sessionID).Msg("anchorUsageProofAndSettle: usage proof anchored on-chain")
	}

	// 5. Settle the escrow — release funds proportionally to bytes consumed.
	settleSig, err := SettleOrderEscrowConsumedBytes(ctx, "api.usage.anchor_and_settle", &order, totalBytes)
	if err != nil {
		logging.Error(err).
			Str("order_id", order.ID.String()).
			Str("escrow_pda", order.EscrowPDA).
			Str("seed_kind", order.EscrowSeedKind).
			Msg("anchorUsageProofAndSettle: SettleOrderEscrow failed")
		// Proof succeeded (or fail-open); durable settle retry via compensation outbox.
		EnqueueEscrowSettleBytes(&order, "api.usage.anchor_and_settle", totalBytes)
		return
	}

	// 6. Mark order completed in DB (tx_hash = settlement signature).
	db.DB.Model(&models.Order{}).Where("id = ?", order.ID).Updates(map[string]interface{}{
		"status":  "completed",
		"tx_hash": settleSig,
	})

	// 7. Mark provider earning as paid — on-chain escrow settlement is the
	// authoritative payout. Update any pending row created by recordProviderEarning;
	// if none exists yet (race), create one directly as paid.
	now := terminatedAt
	updated := db.DB.Model(&models.ProviderEarning{}).
		Where("session_id = ? AND status = 'pending'", session.ID).
		Updates(map[string]interface{}{
			"status":  "paid",
			"tx_hash": settleSig,
			"paid_at": now,
		})
	if updated.RowsAffected == 0 {
		// recordProviderEarning hasn't fired yet (or session had no node).
		// Try to insert a fully-formed paid earning from order pricing.
		if session.NodeID != nil {
			var node models.ProviderNode
			if err := db.DB.First(&node, "id = ? AND deleted_at IS NULL", session.NodeID).Error; err == nil {
				// Escrow PDA settle pays the full proportional seller share on-chain
				// (no treasury fee skim). Record fee as 0 so earnings match chain;
				// platform_fee_bps collection requires a program upgrade.
				// Order.PricePerGB is USD — convert to SOL for gross/net columns.
				const platformFee = 0.0
				bandwidthGBf := float64(totalBytes) / (1024 * 1024 * 1024)
				grossUSD := bandwidthGBf * order.PricePerGB
				gross := billing.USDToSOL(grossUSD)
				fee := gross * platformFee
				net := (gross - fee) * node.GetEarningsMultiplier()
				earning := models.ProviderEarning{
					ProviderUserID:     node.UserID,
					NodeID:             node.ID,
					SessionID:          session.ID,
					BandwidthGB:        bandwidthGBf,
					GrossAmountSOL:     gross,
					PlatformFeeSOL:     fee,
					NetAmountSOL:       net,
					EarningsMultiplier: node.GetEarningsMultiplier(),
					PricePerGB:         billing.USDToSOL(order.PricePerGB),
					Status:             "paid",
					TxHash:             settleSig,
					PaidAt:             &now,
				}
				// Ignore duplicate — unique index on (provider_user_id, session_id) prevents double row.
				_ = db.DB.Create(&earning)
			}
		}
	}

	logging.Info().
		Str("settle_sig", settleSig).
		Str("order_id", order.ID.String()).
		Int64("used_bytes", totalBytes).
		Msg("anchorUsageProofAndSettle: escrow settled on-chain, provider earning recorded as paid")
}

// mustPubkey converts a base58 wallet string to a PublicKey, returning a zero
// key on failure (SettleEscrow will then be a no-op for that party).
func mustPubkey(addr string) sol.PublicKey {
	if addr == "" {
		return sol.PublicKey{}
	}
	pk, err := sol.PublicKeyFromBase58(addr)
	if err != nil {
		return sol.PublicKey{}
	}
	return pk
}

// getSessionUsage returns usage stats for a specific session.
// session_id is the gateway credentials username (see dashboard usage page).
func getSessionUsage(c *gin.Context) {
	sessionID := strings.TrimSpace(c.Param("session_id"))
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session_id required"})
		return
	}

	userID := c.GetString("userID")
	if userID == "" {
		userID = c.GetString("user_id")
	}
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	allowed, found := canAccessSessionUsage(c, userID, sessionID)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		return
	}
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Get from Redis
	usage, err := redisClient.GetUsage(sessionID)
	if err != nil {
		usage = 0
	}

	var session models.Session
	sessionQuery := db.DB.Where("credentials_user = ?", sessionID)
	if id, parseErr := uuid.Parse(sessionID); parseErr == nil {
		sessionQuery = db.DB.Where("credentials_user = ? OR id = ?", sessionID, id)
	}
	_ = sessionQuery.First(&session).Error
	if usage <= 0 && session.BytesUsed > 0 {
		usage = session.BytesUsed
	}

	sessionData, _ := redisClient.GetSession(sessionID)

	var limit int64 = session.BandwidthLimit
	var costPerGBSOL float64 = PricePerGBSOL
	if sessionData != nil {
		if sessionData.BandwidthLimit > 0 {
			limit = sessionData.BandwidthLimit
		}
		if sessionData.PricePerGB > 0 {
			costPerGBSOL = billing.USDToSOL(sessionData.PricePerGB)
		}
	} else if session.ListingID != nil {
		var listing models.ProxyListing
		if err := db.DB.Select("price_per_gb").First(&listing, "id = ?", *session.ListingID).Error; err == nil && listing.PricePerGB > 0 {
			if sol := billing.USDToSOL(listing.PricePerGB); sol > 0 {
				costPerGBSOL = sol
			}
		}
	}

	gbUsed := float64(usage) / (1024 * 1024 * 1024)
	var percentUsed float64
	if limit > 0 {
		percentUsed = float64(usage) / float64(limit) * 100
	}

	c.JSON(http.StatusOK, gin.H{
		"session_id":      sessionID,
		"bytes_used":      usage,
		"bytes_limit":     limit,
		"percent_used":    percentUsed,
		"gb_used":         gbUsed,
		"cost_sol":        gbUsed * costPerGBSOL,
		"last_updated_at": time.Now(),
	})
}

// canAccessSessionUsage returns (allowed, found). Callers that are not the
// buyer, listing seller, or admin must not see another party's metering.
func canAccessSessionUsage(c *gin.Context, userID, sessionKey string) (allowed bool, found bool) {
	if isAdmin(c) {
		return true, true
	}

	if sessionData, err := redisClient.GetSession(sessionKey); err == nil && sessionData != nil {
		found = true
		if sessionData.UserID != "" && sessionData.UserID == userID {
			return true, true
		}
		if sessionData.ProviderID != "" && sessionData.ProviderID == userID {
			return true, true
		}
	}

	if db.DB == nil {
		return false, found
	}

	var session models.Session
	q := db.DB.Where("credentials_user = ?", sessionKey)
	if id, err := uuid.Parse(sessionKey); err == nil {
		q = db.DB.Where("credentials_user = ? OR id = ?", sessionKey, id)
	}
	if err := q.First(&session).Error; err != nil {
		return false, found
	}
	found = true
	if session.UserID.String() == userID {
		return true, true
	}
	if session.ListingID != nil {
		var listing models.ProxyListing
		if err := db.DB.Select("seller_id").First(&listing, "id = ?", *session.ListingID).Error; err == nil {
			if listing.SellerID.String() == userID {
				return true, true
			}
		}
	}
	return false, true
}

// getUserUsage returns aggregated usage for the authenticated user
func getUserUsage(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Filter by status (optional), default to "active" to prevent slow queries on huge history
	status := c.Query("status")
	if status == "" {
		status = "active" // Default optimization
	}

	// 1. Get filtered sessions from DB
	var sessions []models.Session
	query := db.DB.Where("user_id = ?", userID)

	if status != "all" {
		query = query.Where("status = ?", status)
	}

	// Limit to reasonable number if "all" is requested to prevent crash
	if status == "all" {
		query = query.Limit(100).Order("created_at DESC")
	}

	query.Preload("Listing").Find(&sessions)

	// 2. Batch get usage from Redis (Pipeline)
	sessionIDs := make([]string, len(sessions))
	for i, s := range sessions {
		sessionIDs[i] = s.CredentialsUser
	}

	redisStart := time.Now()
	usageMap, err := redisClient.GetBatchUsage(sessionIDs)
	RecordRedisBatchFetch(time.Since(redisStart).Seconds())

	if err != nil {
		logging.Error(err).Msg("Failed to batch fetch usage")
		// Continue with 0 usage on error
		usageMap = make(map[string]int64)
	}

	var totalUsage int64 = 0
	totalCostSOL := 0.0
	sessionStats := make([]gin.H, 0, len(sessions))

	// 3. Construct response
	for _, session := range sessions {
		usage := usageMap[session.CredentialsUser]
		if usage < session.BytesUsed {
			usage = session.BytesUsed
		}
		totalUsage += usage
		gbUsed := float64(usage) / (1024 * 1024 * 1024)
		costPerGBSOL := PricePerGBSOL
		if session.Listing != nil && session.Listing.PricePerGB > 0 {
			costPerGBSOL = billing.USDToSOL(session.Listing.PricePerGB)
		}
		costSOL := gbUsed * costPerGBSOL
		totalCostSOL += costSOL

		sessionStats = append(sessionStats, gin.H{
			"session_id": session.ID,
			"type":       session.Type,
			"status":     session.Status,
			"bytes_used": usage,
			"gb_used":    gbUsed,
			"cost_sol":   costSOL,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id":        userID,
		"total_bytes":    totalUsage,
		"total_gb":       float64(totalUsage) / (1024 * 1024 * 1024),
		"total_cost_sol": totalCostSOL,
		"sessions":       sessionStats,
		"count":          len(sessions),
		"filter":         status,
	})
}

// signUsageRequest represents the request to sign usage for a specific buyer
type signUsageRequest struct {
	BuyerAddress string `json:"buyer_address" binding:"required"`
}

// signUsageClaim generates an Oracle signature for a provider to claim earnings from a buyer
func signUsageClaim(c *gin.Context) {
	// 1. Get Authenticated Provider (Internal User ID)
	providerID := c.GetString("userID")
	if providerID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	// 2. Bind Request
	var req signUsageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 3. Get Oracle Signer
	signer := GetOracleSigner()
	if signer == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Oracle signer not configured"})
		return
	}

	// 4. Retrieve Usage Stats from Redis
	// Fetch real usage for this provider-buyer pair
	// Note: req.BuyerAddress IS the wallet address from the client perspective,
	// but in Redis we stored Internal UserID. So we need to map Buyer Address -> Internal UserID to look up usage,
	// OR we stored usage keyed by Internal UserID.
	// Let's assume Redis keys are: usage:provider:{providerID}:user:{userID}.

	// Reverse Lookup: Find UserID from BuyerAddress (Wallet)
	var buyerUser models.User
	if err := db.DB.Where("wallet_address = ? OR bittensor_address = ?", req.BuyerAddress, req.BuyerAddress).First(&buyerUser).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Buyer wallet not registered"})
		return
	}

	bytesUsed, err := redisClient.GetTotalProviderUsage(providerID, buyerUser.ID.String())
	if err != nil {
		logging.Error(err).Msg("Failed to retrieve usage stats")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve usage data"})
		return
	}

	if bytesUsed == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No usage found to claim"})
		return
	}

	// 5. Generate Nonce
	nonce, err := redisClient.IncrementNonce(providerID, buyerUser.ID.String())
	if err != nil {
		logging.Error(err).Msg("Failed to generate nonce")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Crypto failure"})
		return
	}

	// 6. Resolve Provider Wallet Address
	var providerUser models.User
	if err := db.DB.Where("id = ?", providerID).First(&providerUser).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Provider profile error"})
		return
	}

	providerWallet := ""
	if providerUser.WalletAddress != nil {
		providerWallet = *providerUser.WalletAddress
	}
	// Fallback or prefer specific chain logic if needed.
	if providerWallet == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Provider must link a wallet to claim earnings"})
		return
	}

	// 7. Sign (Using WALLET ADDRESSES now)
	signature, err := signer.SignUsage(
		req.BuyerAddress, // Client provided wallet address (verified exists)
		providerWallet,   // Provider's linked wallet
		big.NewInt(bytesUsed),
		new(big.Int).SetUint64(nonce),
	)

	if err != nil {
		logging.Error(err).Msg("Failed to generate signature")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Signing failure"})
		return
	}

	// 8. Respond
	c.JSON(http.StatusOK, gin.H{
		"signature":     fmt.Sprintf("0x%x", signature),
		"buyer":         req.BuyerAddress,
		"provider":      providerWallet,
		"bytes_used":    bytesUsed,
		"nonce":         nonce,
		"token_address": "0x0000000000000000000000000000000000000000",
	})
}
