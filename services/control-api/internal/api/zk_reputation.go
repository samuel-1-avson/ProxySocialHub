// Package api — ZK batch proof endpoints (L2 Phase 4).
//
// These endpoints replace the previous 501 stubs with real ZK batch
// settlement functionality.
//
// POST /zk/batch/submit  — edge gateway submits a batch of signed proofs;
//                          the server generates the Merkle root and commits
//                          it on-chain.
// GET  /zk/batch/:root   — returns the on-chain status of a batch by root.
// GET  /reputation/telemetry — returns a user's on-chain ZK settlement history.
package api

import (
	"encoding/hex"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/zk"
)

// RegisterReputationRoutes registers ZK proof and reputation endpoints.
func RegisterReputationRoutes(rg *gin.RouterGroup) {
	rg.POST("/zk/batch/submit", submitZKBatch)
	rg.GET("/zk/batch/:root", getZKBatch)
	rg.GET("/reputation/telemetry", getReputationTelemetry)
}

// ZKProofLeafInput is the per-session input submitted by the edge gateway.
type ZKProofLeafInput struct {
	SessionID   string `json:"session_id" binding:"required"`
	TotalBytes  uint64 `json:"total_bytes" binding:"required"`
	PeriodStart int64  `json:"period_start" binding:"required"` // Unix
	PeriodEnd   int64  `json:"period_end" binding:"required"`   // Unix
	BuyerSig    string `json:"buyer_sig" binding:"required"`    // base58 Ed25519
	ProviderSig string `json:"provider_sig" binding:"required"` // base58 Ed25519
}

type SubmitZKBatchRequest struct {
	Proofs []ZKProofLeafInput `json:"proofs" binding:"required,min=1,max=50"`
}

// submitZKBatch accepts a batch of signed proof leaves, generates the Merkle
// commitment, and queues on-chain submission.  This is the primary L2 settlement
// endpoint called by the edge gateway after every 15-minute metering window.
func submitZKBatch(c *gin.Context) {
	// Must be called by a provider node or the oracle (service-level auth).
	role, _ := c.Get("userRole")
	if role != "provider" && role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "only providers or admins may submit ZK batches"})
		return
	}

	var req SubmitZKBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	prover := zk.NewProver()
	leaves := make([]zk.ProofLeaf, 0, len(req.Proofs))

	for _, p := range req.Proofs {
		sid, err := uuid.Parse(p.SessionID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid session_id: " + p.SessionID})
			return
		}
		var sidBytes [16]byte
		copy(sidBytes[:], sid[:])

		buyerSig, err := base58.Decode(p.BuyerSig)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid buyer_sig encoding for session " + p.SessionID})
			return
		}
		providerSig, err := base58.Decode(p.ProviderSig)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid provider_sig encoding for session " + p.SessionID})
			return
		}

		leaves = append(leaves, zk.ProofLeaf{
			SessionID:   sidBytes,
			TotalBytes:  p.TotalBytes,
			PeriodStart: p.PeriodStart,
			PeriodEnd:   p.PeriodEnd,
			BuyerSig:    buyerSig,
			ProviderSig: providerSig,
		})
	}

	batch, err := prover.GenerateBatchProof(leaves)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "proof generation failed: " + err.Error()})
		return
	}

	rootHex := hex.EncodeToString(batch.Root[:])

	// Check for duplicate submission (idempotent).
	var existing models.ZKBatch
	if db.DB.Where("batch_root = ?", rootHex).First(&existing).Error == nil {
		c.JSON(http.StatusOK, gin.H{
			"message":    "batch already submitted",
			"batch_root": rootHex,
			"status":     existing.Status,
			"tx_sig":     existing.OnChainTxSig,
		})
		return
	}

	// Persist as pending — the ZKSettlementWorker will pick it up for on-chain
	// submission, or we can trigger it inline here for smaller batches.
	zkBatch := models.ZKBatch{
		BatchRoot:    rootHex,
		SessionCount: batch.SessionCount,
		TotalBytes:   batch.TotalBytes,
		PeriodStart:  time.Unix(batch.PeriodStart, 0),
		PeriodEnd:    time.Unix(batch.PeriodEnd, 0),
		Status:       models.ZKBatchPending,
	}
	if err := db.DB.Create(&zkBatch).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist batch"})
		return
	}

	// Trigger on-chain submission inline (async goroutine so the HTTP response
	// returns immediately; the worker also retries if this fails).
	go func(b *zk.BatchProof, root string) {
		agg := billing.NewZKAggregator()
		if err := agg.SubmitBatchDirect(c.Request.Context(), b, root); err != nil {
			logging.Error(err).Str("root", root).Msg("submitZKBatch: async on-chain submission failed")
		}
	}(batch, rootHex)

	c.JSON(http.StatusAccepted, gin.H{
		"message":       "batch accepted for on-chain settlement",
		"batch_root":    rootHex,
		"session_count": batch.SessionCount,
		"total_bytes":   batch.TotalBytes,
		"status":        models.ZKBatchPending,
	})
}

// getZKBatch returns the on-chain status of a batch by its hex root.
func getZKBatch(c *gin.Context) {
	rootHex := c.Param("root")
	if len(rootHex) != 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "batch root must be 64 hex characters"})
		return
	}

	var batch models.ZKBatch
	if err := db.DB.Where("batch_root = ?", rootHex).First(&batch).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "batch not found"})
		return
	}

	c.JSON(http.StatusOK, batch)
}

// getReputationTelemetry returns a user's ZK-settled bandwidth history.
func getReputationTelemetry(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Fetch on-chain proofs associated with this user's sessions.
	var proofs []models.UsageProof
	if err := db.DB.
		Joins("JOIN sessions ON sessions.id = usage_proofs.session_id").
		Where("sessions.user_id = ? AND usage_proofs.status = ?", userID, models.UsageProofOnChain).
		Order("usage_proofs.created_at DESC").
		Limit(100).
		Find(&proofs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch telemetry"})
		return
	}

	// Aggregate stats.
	var totalBytes int64
	for _, p := range proofs {
		totalBytes += p.TotalBytes
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id":             userID,
		"settled_proof_count": len(proofs),
		"total_bytes_settled": totalBytes,
		"proofs":              proofs,
		// BC-11 honesty: batches are oracle-attested Merkle anchors; on-chain
		// Groth16 / trustless ZK reputation is not live (Sprint B).
		"verification_mode":          "oracle_attested_merkle",
		"onchain_groth16":            false,
		"onchain_zk_verify_available": false,
		"reputation_program":         "oracle_gated_stub_not_deployed",
	})
}
