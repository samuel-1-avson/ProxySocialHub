package worker

import (
	"context"
	"log"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/ws"
)

var (
	lastKnownUsage = make(map[string]int64)
	lastAnchorTime = make(map[string]time.Time)
)

const anchorInterval = 5 * time.Minute // Anchor every 5 minutes

// StartTelemetryWorker periodically pushes usage updates to active sessions
func StartTelemetryWorker() {
	ticker := time.NewTicker(5 * time.Second)
	log.Printf("[Worker] Telemetry Worker started (Interval: 5s)")

	go func() {
		for range ticker.C {
			pushTelemetry()
		}
	}()
}

func pushTelemetry() {
	var activeSessions []models.Session
	db.DB.Where("status = ?", models.SessionActive).Find(&activeSessions)

	for _, session := range activeSessions {
		usage, err := redis.GetUsage(session.CredentialsUser)
		if err != nil {
			continue
		}

		// Only broadcast if usage has changed
		if usage > lastKnownUsage[session.ID.String()] {
			lastKnownUsage[session.ID.String()] = usage

			// Broadcast via NATS distributed hub (Phase 15/17)
			ws.BroadcastToUser(session.UserID.String(), ws.MsgTypeUsageUpdate, map[string]interface{}{
				"session_id":     session.ID,
				"bandwidth_used": usage,
				"timestamp":      time.Now().UnixMilli(),
			})
		}

		// DECENTRALIZATION (Phase 22): Anchor Usage to Blockchain
		if time.Since(lastAnchorTime[session.ID.String()]) >= anchorInterval {
			lastAnchorTime[session.ID.String()] = time.Now()

			// Only anchor if there is usage
			if usage > 0 {
				go anchorUsage(session, usage)
			}
		}
	}
}

func anchorUsage(session models.Session, totalBytes int64) {
	log.Printf("[TelemetryWorker] Anchoring usage for session %s: %d bytes", session.ID, totalBytes)

	proofService := solana.GetProofService()
	if proofService == nil {
		return
	}

	// 1. Fetch Order associated with session to get Escrow PDA
	var order models.Order
	if err := db.DB.Where("session_id = ?", session.ID).First(&order).Error; err != nil {
		log.Printf("[TelemetryWorker] Failed to find order for session %s, skipping anchor", session.ID)
		return
	}

	if order.EscrowPDA == "" {
		return
	}

	escrowPDA, err := sol.PublicKeyFromBase58(order.EscrowPDA)
	if err != nil {
		return
	}

	// 2. Create Statement
	periodEnd := time.Now().Unix()
	periodStart := periodEnd - int64(anchorInterval.Seconds())

	statement, err := proofService.CreateUsageStatement(escrowPDA, uint64(totalBytes), periodStart, periodEnd)
	if err != nil {
		log.Printf("[TelemetryWorker] Failed to create usage statement: %v", err)
		return
	}

	// 3. Submit to Chain (and save to DB)
	// Usage index simplified to 0 for now or incrementing
	_, err = proofService.SubmitProofToChain(context.Background(), statement, 0)
	if err != nil {
		log.Printf("[TelemetryWorker] Failed to anchor usage on-chain: %v", err)
	}
}
