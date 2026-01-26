package api

import (
	"log"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/ws"
)

// SystemUserID is a reserved UUID for system-generated messages
var SystemUserID = uuid.MustParse("00000000-0000-0000-0000-000000000001")

// SendSystemNotification sends a real-time notification to a user via the Distributed Hub
func SendSystemNotification(userID string, title, message string) {
	log.Printf("[Notification] Sending system alert to %s: %s", userID, title)

	// Broadcast via the distributed NATS hub (Phase 15/17)
	ws.BroadcastToUser(userID, ws.MsgTypeNotification, map[string]interface{}{
		"title":     title,
		"message":   message,
		"is_system": true,
	})
}

// SendSystemAlert broadcasts an emergency alert to ALL connected users
func SendSystemAlert(message string) {
	log.Printf("[Notification] Broadcasting system-wide alert: %s", message)

	ws.BroadcastToAll(ws.MsgTypeSystemAlert, map[string]interface{}{
		"message": message,
		"level":   "critical",
	})
}
