package worker

import (
	"log"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/ws"
)

var lastKnownUsage = make(map[string]int64)

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
	}
}
