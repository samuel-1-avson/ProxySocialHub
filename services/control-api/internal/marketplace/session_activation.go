package marketplace

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

const (
	SessionActivationEventSource = "session_activation"
	SessionActivationEventType   = "session_activation"
)

var sessionActivationAttemptsTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "proxyhubb_session_activation_attempts_total",
		Help: "Total number of marketplace session activation attempts by result.",
	},
	[]string{"result"},
)

// ActivateOrderSession enables gateway auth for a marketplace order after escrow is confirmed.
func ActivateOrderSession(ctx context.Context, orderID uuid.UUID) error {
	var order models.Order
	if err := db.DB.First(&order, "id = ?", orderID).Error; err != nil {
		return fmt.Errorf("order not found: %w", err)
	}
	if order.SessionID == nil {
		return fmt.Errorf("order %s has no linked session", orderID)
	}
	if order.Status != models.OrderStatusActive && order.Status != models.OrderStatusCompleted {
		return fmt.Errorf("order %s is not confirmed for session activation: %s", orderID, order.Status)
	}

	var session models.Session
	if err := db.DB.First(&session, "id = ?", *order.SessionID).Error; err != nil {
		return fmt.Errorf("session not found: %w", err)
	}

	if err := transitionSessionActivationStatus(&session, models.SessionActivationPending); err != nil {
		return err
	}
	sessionActivationAttemptsTotal.WithLabelValues("pending").Inc()
	if err := RecordSessionActivationEvent(&order, &session, models.EscrowReconciliationStatusActivationPending, "redis_sync_pending", "", true); err != nil {
		return fmt.Errorf("failed to record session activation attempt: %w", err)
	}

	if err := syncSessionToRedis(ctx, &order, &session); err != nil {
		_ = transitionSessionActivationStatus(&session, models.SessionActivationFailed)
		sessionActivationAttemptsTotal.WithLabelValues("failed").Inc()
		_ = RecordSessionActivationEvent(&order, &session, models.EscrowReconciliationStatusActivationFailed, "redis_sync_failed", err.Error(), false)
		return fmt.Errorf("session activation failed: %w", err)
	}

	if err := transitionSessionActivationStatus(&session, models.SessionActive); err != nil {
		sessionActivationAttemptsTotal.WithLabelValues("failed").Inc()
		_ = RecordSessionActivationEvent(&order, &session, models.EscrowReconciliationStatusActivationFailed, "db_status_sync_failed", err.Error(), false)
		return err
	}
	sessionActivationAttemptsTotal.WithLabelValues("synced").Inc()
	if err := RecordSessionActivationEvent(&order, &session, models.EscrowReconciliationStatusActivationSynced, "redis_sync_succeeded", "", false); err != nil {
		return fmt.Errorf("failed to mark session activation synced: %w", err)
	}
	return nil
}

func transitionSessionActivationStatus(session *models.Session, next models.SessionStatus) error {
	if session.Status == next {
		return nil
	}
	if err := models.ValidateSessionStatusTransition(session.Status, next); err != nil {
		return err
	}
	if err := db.DB.Model(session).Update("status", next).Error; err != nil {
		return fmt.Errorf("failed to update session status to %s: %w", next, err)
	}
	session.Status = next
	return nil
}

func syncSessionToRedis(ctx context.Context, order *models.Order, session *models.Session) error {
	if redisClient.Client == nil {
		return fmt.Errorf("redis client unavailable")
	}

	var buyer models.User
	if err := db.DB.First(&buyer, "id = ?", order.BuyerID).Error; err != nil {
		return fmt.Errorf("buyer profile not found: %w", err)
	}

	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ?", order.ListingID).Error; err != nil {
		return fmt.Errorf("listing not found: %w", err)
	}

	node, err := loadSessionProviderNode(session, &listing)
	if err != nil {
		return err
	}

	sessionData := &redisClient.SessionData{
		UserID:                 order.BuyerID.String(),
		SessionID:              session.ID.String(),
		ProviderID:             order.SellerID.String(),
		Type:                   string(session.Type),
		Status:                 "active",
		BandwidthLimit:         session.BandwidthLimit,
		BandwidthUsed:          session.BytesUsed,
		TrustTier:              string(buyer.TrustTier),
		TargetGeo:              listing.Country,
		TargetISP:              listing.ISP,
		ListingID:              listing.ID.String(),
		NodeID:                 GatewayRoutingNodeID(node),
		NodeHost:               node.IPAddress,
		NodePort:               node.Port,
		PricePerGB:             listing.PricePerGB,
		CredentialPasswordHash: HashCredentialPassword(session.CredentialsPass),
		ExpiresAt:              time.Now().Add(24 * time.Hour),
		CreatedAt:              time.Now(),
	}

	if err := redisClient.StoreSession(session.CredentialsUser, sessionData, 24*time.Hour); err != nil {
		return fmt.Errorf("redis session sync failed: %w", err)
	}
	return nil
}

// RecordSessionActivationEvent stores the durable activation state used by
// retry workers and operator dashboards.
func RecordSessionActivationEvent(order *models.Order, session *models.Session, status, reason, lastError string, incrementAttempt bool) error {
	if order == nil || session == nil {
		return fmt.Errorf("order and session are required")
	}
	if status == "" {
		status = models.EscrowReconciliationStatusActivationPending
	}
	now := time.Now()
	payloadBytes, err := json.Marshal(map[string]interface{}{
		"order_id":       order.ID.String(),
		"session_id":     session.ID.String(),
		"session_status": string(session.Status),
		"redis_key":      "session:" + session.CredentialsUser,
		"listing_id":     order.ListingID.String(),
		"buyer_id":       order.BuyerID.String(),
		"seller_id":      order.SellerID.String(),
	})
	if err != nil {
		return fmt.Errorf("failed to marshal activation event payload: %w", err)
	}

	escrowPDA := order.EscrowPDA
	if escrowPDA == "" {
		escrowPDA = "order:" + order.ID.String()
	}
	txSignature := order.TxSignature
	if txSignature == "" {
		txSignature = order.TxHash
	}

	var existing models.EscrowReconciliationEvent
	err = db.DB.Where(
		"source = ? AND event_type = ? AND escrow_pda = ? AND tx_signature = ?",
		SessionActivationEventSource,
		SessionActivationEventType,
		escrowPDA,
		txSignature,
	).First(&existing).Error
	if err == nil {
		updates := map[string]interface{}{
			"order_id":     order.ID,
			"status":       status,
			"reason":       reason,
			"last_error":   lastError,
			"payload":      datatypes.JSON(payloadBytes),
			"last_seen_at": now,
			"updated_at":   now,
		}
		if incrementAttempt {
			updates["attempts"] = gorm.Expr("attempts + ?", 1)
		}
		if status == models.EscrowReconciliationStatusActivationSynced {
			updates["resolved_at"] = now
		} else {
			updates["resolved_at"] = nil
		}
		return db.DB.Model(&existing).Updates(updates).Error
	}
	if err != gorm.ErrRecordNotFound {
		return err
	}

	event := models.EscrowReconciliationEvent{
		Source:      SessionActivationEventSource,
		EventType:   SessionActivationEventType,
		EscrowPDA:   escrowPDA,
		TxSignature: txSignature,
		OrderID:     &order.ID,
		Status:      status,
		Reason:      reason,
		LastError:   lastError,
		Attempts:    1,
		Payload:     datatypes.JSON(payloadBytes),
		FirstSeenAt: now,
		LastSeenAt:  now,
	}
	if status == models.EscrowReconciliationStatusActivationSynced {
		event.ResolvedAt = &now
	}
	return db.DB.Create(&event).Error
}

func loadSessionProviderNode(session *models.Session, listing *models.ProxyListing) (*models.ProviderNode, error) {
	if session.NodeID != nil && *session.NodeID != uuid.Nil {
		var node models.ProviderNode
		if err := db.DB.Where("id = ? AND user_id = ? AND deleted_at IS NULL", *session.NodeID, listing.SellerID).
			First(&node).Error; err == nil {
			return &node, nil
		}
		var mirror models.Node
		if err := db.DB.Where("id = ? AND deleted_at IS NULL", *session.NodeID).First(&mirror).Error; err == nil &&
			mirror.ProviderNodeID != nil {
			if err := db.DB.Where("id = ? AND user_id = ? AND deleted_at IS NULL", *mirror.ProviderNodeID, listing.SellerID).
				First(&node).Error; err == nil {
				return &node, nil
			}
		}
	}
	return ResolveListingProviderNode(listing)
}

// BuildRedisSessionData constructs gateway session metadata for marketplace purchases.
func BuildRedisSessionData(order *models.Order, session *models.Session, listing *models.ProxyListing, node *models.ProviderNode, buyer *models.User) *redisClient.SessionData {
	return &redisClient.SessionData{
		UserID:                 order.BuyerID.String(),
		SessionID:              session.ID.String(),
		ProviderID:             order.SellerID.String(),
		Type:                   string(session.Type),
		Status:                 "active",
		BandwidthLimit:         session.BandwidthLimit,
		BandwidthUsed:          session.BytesUsed,
		TrustTier:              string(buyer.TrustTier),
		TargetGeo:              listing.Country,
		TargetISP:              listing.ISP,
		ListingID:              listing.ID.String(),
		NodeID:                 GatewayRoutingNodeID(node),
		NodeHost:               node.IPAddress,
		NodePort:               node.Port,
		PricePerGB:             listing.PricePerGB,
		CredentialPasswordHash: HashCredentialPassword(session.CredentialsPass),
		ExpiresAt:              time.Now().Add(24 * time.Hour),
		CreatedAt:              time.Now(),
	}
}
