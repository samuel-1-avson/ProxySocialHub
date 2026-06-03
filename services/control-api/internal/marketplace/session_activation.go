package marketplace

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
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

	var session models.Session
	if err := db.DB.First(&session, "id = ?", *order.SessionID).Error; err != nil {
		return fmt.Errorf("session not found: %w", err)
	}

	if session.Status == models.SessionActive {
		return syncSessionToRedis(ctx, &order, &session)
	}

	if err := models.ValidateSessionStatusTransition(session.Status, models.SessionActive); err != nil {
		return err
	}

	if err := db.DB.Model(&session).Update("status", models.SessionActive).Error; err != nil {
		return fmt.Errorf("failed to activate session: %w", err)
	}
	session.Status = models.SessionActive

	return syncSessionToRedis(ctx, &order, &session)
}

func syncSessionToRedis(ctx context.Context, order *models.Order, session *models.Session) error {
	var buyer models.User
	if err := db.DB.First(&buyer, "id = ?", order.BuyerID).Error; err != nil {
		return fmt.Errorf("buyer profile not found: %w", err)
	}

	sessionData := &redisClient.SessionData{
		UserID:         order.BuyerID.String(),
		SessionID:      session.ID.String(),
		ProviderID:     order.SellerID.String(),
		Type:           string(session.Type),
		Status:         "active",
		BandwidthLimit: session.BandwidthLimit,
		BandwidthUsed:  session.BytesUsed,
		TrustTier:      string(buyer.TrustTier),
		ExpiresAt:      time.Now().Add(24 * time.Hour),
		CreatedAt:      time.Now(),
	}

	if err := redisClient.StoreSession(session.CredentialsUser, sessionData, 24*time.Hour); err != nil {
		return fmt.Errorf("redis session sync failed: %w", err)
	}
	return nil
}
