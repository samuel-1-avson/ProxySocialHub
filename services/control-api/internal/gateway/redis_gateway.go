package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/proxyhubb/control-api/internal/core/domain"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

// sessionData is the JSON structure that the edge gateway reads from Redis.
type sessionData struct {
	UserID         string `json:"user_id"`
	SessionID      string `json:"session_id"`
	ProviderID     string `json:"provider_id"`
	Type           string `json:"type"`
	Status         string `json:"status"`
	BandwidthLimit int64  `json:"bandwidth_limit"`
	BandwidthUsed  int64  `json:"bandwidth_used"`
	TrustTier      string `json:"trust_tier"`
	TargetGeo      string `json:"target_geo"`
	TargetISP      string `json:"target_isp"`
}

// RedisGateway implements ports.ProxyGateway using Redis as the provisioning backend.
type RedisGateway struct{}

// NewRedisGateway returns a new RedisGateway.
func NewRedisGateway() *RedisGateway {
	return &RedisGateway{}
}

// ProvisionSession writes the session credentials to Redis so the edge gateway can
// authenticate proxy traffic.  Key: session:{username}, TTL: 24h.
// A reverse-index key session_id_creds:{sessionID} -> username is also stored for teardown.
func (g *RedisGateway) ProvisionSession(ctx context.Context, session *domain.SessionEntity) error {
	if redisClient.Client == nil {
		return fmt.Errorf("redis client not initialized")
	}

	data := sessionData{
		UserID:         session.BuyerID,
		SessionID:      session.ID,
		ProviderID:     session.ProviderID,
		Type:           "rotating",
		Status:         "active",
		BandwidthLimit: session.BandwidthLimit,
		BandwidthUsed:  0,
		TrustTier:      "standard",
		TargetGeo:      "",
		TargetISP:      "",
	}

	payload, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal session data: %w", err)
	}

	ttl := 24 * time.Hour
	sessionKey := "session:" + session.CredentialsUser
	if err := redisClient.Client.Set(ctx, sessionKey, payload, ttl).Err(); err != nil {
		return fmt.Errorf("failed to write session to redis: %w", err)
	}

	// Reverse index: session ID -> credentials username (for TerminateSession lookup)
	reverseKey := "session_id_creds:" + session.ID
	if err := redisClient.Client.Set(ctx, reverseKey, session.CredentialsUser, ttl).Err(); err != nil {
		return fmt.Errorf("failed to write reverse index to redis: %w", err)
	}

	return nil
}

// TerminateSession looks up the credentials username from the reverse index, then
// deletes the session key, any sticky key, and the reverse index itself.
func (g *RedisGateway) TerminateSession(ctx context.Context, sessionID string) error {
	if redisClient.Client == nil {
		return fmt.Errorf("redis client not initialized")
	}

	reverseKey := "session_id_creds:" + sessionID
	username, err := redisClient.Client.Get(ctx, reverseKey).Result()
	if err != nil {
		return fmt.Errorf("failed to look up credentials for session %s: %w", sessionID, err)
	}

	sessionKey := "session:" + username
	stickyKey := "sticky:" + sessionID

	redisClient.Client.Del(ctx, sessionKey, stickyKey, reverseKey)

	return nil
}

// VerifyHealth checks whether the provider's health heartbeat key exists in Redis.
func (g *RedisGateway) VerifyHealth(ctx context.Context, providerID string) (bool, error) {
	if redisClient.Client == nil {
		return false, fmt.Errorf("redis client not initialized")
	}

	key := "node:" + providerID + ":health"
	count, err := redisClient.Client.Exists(ctx, key).Result()
	if err != nil {
		return false, err
	}
	return count > 0, nil
}
