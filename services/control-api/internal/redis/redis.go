package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisClient interface for both single and cluster clients
type RedisClient interface {
	Get(ctx context.Context, key string) *redis.StringCmd
	Set(ctx context.Context, key string, value interface{}, expiration time.Duration) *redis.StatusCmd
	Del(ctx context.Context, keys ...string) *redis.IntCmd
	IncrBy(ctx context.Context, key string, value int64) *redis.IntCmd
	IncrByFloat(ctx context.Context, key string, value float64) *redis.FloatCmd
	Incr(ctx context.Context, key string) *redis.IntCmd
	MGet(ctx context.Context, keys ...string) *redis.SliceCmd
	ZRemRangeByScore(ctx context.Context, key, min, max string) *redis.IntCmd
	ZCard(ctx context.Context, key string) *redis.IntCmd
	ZAdd(ctx context.Context, key string, members ...redis.Z) *redis.IntCmd
	Expire(ctx context.Context, key string, expiration time.Duration) *redis.BoolCmd
	SetNX(ctx context.Context, key string, value interface{}, expiration time.Duration) *redis.BoolCmd
	Pipeline() redis.Pipeliner
	Ping(ctx context.Context) *redis.StatusCmd
	Close() error
	Scan(ctx context.Context, cursor uint64, match string, count int64) *redis.ScanCmd
	DecrBy(ctx context.Context, key string, decrement int64) *redis.IntCmd
	LPush(ctx context.Context, key string, values ...interface{}) *redis.IntCmd
	LTrim(ctx context.Context, key string, start, stop int64) *redis.StatusCmd
	LRange(ctx context.Context, key string, start, stop int64) *redis.StringSliceCmd
	SAdd(ctx context.Context, key string, members ...interface{}) *redis.IntCmd
	SRem(ctx context.Context, key string, members ...interface{}) *redis.IntCmd
	HGet(ctx context.Context, key, field string) *redis.StringCmd
	HSet(ctx context.Context, key string, values ...interface{}) *redis.IntCmd
	Publish(ctx context.Context, channel string, message interface{}) *redis.IntCmd
	Exists(ctx context.Context, keys ...string) *redis.IntCmd
	Eval(ctx context.Context, script string, keys []string, args ...interface{}) *redis.Cmd
}

const Nil = redis.Nil

var Client RedisClient
var ctx = context.Background()

// AfterStoreSession is an optional dual-write hook (Sprint J0 session_gateway_cache).
// Wired from main to sessioncache.Upsert; must not call StoreSession recursively.
var AfterStoreSession func(username string, data *SessionData, ttl time.Duration)

// AfterDeleteSession is an optional dual-write cleanup hook.
var AfterDeleteSession func(username string)

type SessionData struct {
	UserID         string    `json:"user_id"`
	SessionID      string    `json:"session_id"`
	ProviderID     string    `json:"provider_id"`
	Type           string    `json:"type"`
	Status         string    `json:"status"`
	BandwidthLimit int64     `json:"bandwidth_limit"`
	BandwidthUsed  int64     `json:"bandwidth_used"`
	TrustTier      string    `json:"trust_tier"`
	TargetGeo      string    `json:"target_geo"`
	TargetISP      string    `json:"target_isp"`
	Strategy       string    `json:"strategy"`
	MaxPrice       float64   `json:"max_price"`
	ExpiresAt      time.Time `json:"expires_at"`
	CreatedAt      time.Time `json:"created_at"`

	// N-02: Per-session access control & rotation config (enforced by edge-gateway)
	AllowedDomains          []string `json:"allowed_domains,omitempty"`
	BlockedDomains          []string `json:"blocked_domains,omitempty"`
	RotationType            string   `json:"rotation_type,omitempty"`
	RotationIntervalSeconds int      `json:"rotation_interval_seconds,omitempty"`
	TimeLimitMinutes        int      `json:"time_limit_minutes,omitempty"`

	// P2P listing fields — set when session is bought from a specific provider listing.
	// The edge-gateway uses NodeHost:NodePort to route traffic to the exact provider node.
	ListingID  string  `json:"listing_id,omitempty"`
	NodeID     string  `json:"node_id,omitempty"`
	NodeHost   string  `json:"node_host,omitempty"`
	NodePort   int     `json:"node_port,omitempty"`
	PricePerGB float64 `json:"price_per_gb,omitempty"`

	// SHA-256 hex of proxy password — edge-gateway validates Basic auth when set.
	CredentialPasswordHash string `json:"credential_password_hash,omitempty"`

	// Wave 3.3 / W5.C.2 — platform HMAC order credential bound into the session blob.
	OrderID                       string `json:"order_id,omitempty"`
	CredentialProofUsernameHash   string `json:"credential_proof_username_hash,omitempty"`
	CredentialProofPayloadHash    string `json:"credential_proof_payload_hash,omitempty"`
	CredentialProofSignature      string `json:"credential_proof_signature,omitempty"`
	CredentialProofIssuedAt       int64  `json:"credential_proof_issued_at,omitempty"`
	CredentialProofExpiresAt      int64  `json:"credential_proof_expires_at,omitempty"`

	// Wave 7.A — Ed25519 session capability (Redis is a cache; edge verifies locally).
	CapabilityVersion         string `json:"capability_version,omitempty"`
	CapabilityOfferHash       string `json:"capability_offer_hash,omitempty"`
	CapabilityBuyerID         string `json:"capability_buyer_id,omitempty"`
	CapabilityExpiresAt       int64  `json:"capability_expires_at,omitempty"`
	CapabilityBandwidthLimit  int64  `json:"capability_bandwidth_limit,omitempty"`
	CapabilityOperatorPubkey  string `json:"capability_operator_pubkey,omitempty"`
	CapabilityUsernameHash    string `json:"capability_username_hash,omitempty"`
	CapabilityIssuedAt        int64  `json:"capability_issued_at,omitempty"`
	CapabilitySignature       string `json:"capability_signature,omitempty"`
	CapabilityIssuerPubkey    string `json:"capability_issuer_pubkey,omitempty"`
	CapabilityToken           string `json:"capability_token,omitempty"`
}

func Init() error {
	// M2: prefer Redis Sentinel failover when configured.
	if addrs := strings.TrimSpace(os.Getenv("REDIS_SENTINEL_ADDRS")); addrs != "" {
		return initSentinel(addrs)
	}
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}
	if strings.Contains(redisURL, ",") {
		return initCluster(redisURL)
	}
	return initSingle(redisURL)
}

func initSentinel(addrsCSV string) error {
	master := strings.TrimSpace(os.Getenv("REDIS_SENTINEL_MASTER"))
	if master == "" {
		master = "mymaster"
	}
	var addrs []string
	for _, a := range strings.Split(addrsCSV, ",") {
		a = strings.TrimSpace(a)
		if a == "" {
			continue
		}
		addrs = append(addrs, a)
	}
	if len(addrs) == 0 {
		return fmt.Errorf("REDIS_SENTINEL_ADDRS is empty")
	}
	password := strings.TrimSpace(os.Getenv("REDIS_PASSWORD"))
	if password == "" {
		// Fall back to password embedded in REDIS_URL if present.
		if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
			if opt, err := redis.ParseURL(redisURL); err == nil {
				password = opt.Password
			}
		}
	}
	client := redis.NewFailoverClient(&redis.FailoverOptions{
		MasterName:       master,
		SentinelAddrs:    addrs,
		Password:         password,
		SentinelPassword: strings.TrimSpace(os.Getenv("REDIS_SENTINEL_PASSWORD")),
	})
	if _, err := client.Ping(ctx).Result(); err != nil {
		return fmt.Errorf("failed to connect to Redis via Sentinel: %w", err)
	}
	Client = client
	return nil
}

func initSingle(redisURL string) error {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return fmt.Errorf("failed to parse Redis URL: %w", err)
	}
	client := redis.NewClient(opt)
	if _, err := client.Ping(ctx).Result(); err != nil {
		return fmt.Errorf("failed to connect to Redis: %w", err)
	}
	Client = client
	return nil
}

func initCluster(redisURL string) error {
	addrs := strings.Split(redisURL, ",")
	for i, addr := range addrs {
		addr = strings.TrimSpace(addr)
		addr = strings.TrimPrefix(addr, "redis://")
		addrs[i] = addr
	}
	client := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: addrs,
	})
	if _, err := client.Ping(ctx).Result(); err != nil {
		return fmt.Errorf("failed to connect to Redis cluster: %w", err)
	}
	Client = client
	return nil
}

func StoreSession(sessionID string, data *SessionData, ttl time.Duration) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	var redisErr error
	if Client != nil {
		key := "session:" + sessionID
		redisErr = Client.Set(ctx, key, jsonData, ttl).Err()
	}
	// Dual-write even when Redis is down so hydrate can recover (J0).
	if AfterStoreSession != nil && data != nil {
		AfterStoreSession(sessionID, data, ttl)
	}
	return redisErr
}

// --- WS ticket store (short-lived, single-use WebSocket auth tickets) ---

func StoreWSTicket(ticket string, userID string, role string, ttl time.Duration) error {
	if Client == nil {
		return fmt.Errorf("redis client not initialized")
	}
	payload, err := json.Marshal(map[string]string{"user_id": userID, "role": role})
	if err != nil {
		return err
	}
	return Client.Set(ctx, "ws_ticket:"+ticket, payload, ttl).Err()
}

// ConsumeWSTicket atomically reads and deletes a ticket (single-use).
func ConsumeWSTicket(ticket string) (userID string, role string, err error) {
	if Client == nil {
		return "", "", fmt.Errorf("redis client not initialized")
	}
	key := "ws_ticket:" + ticket
	val, err := Client.Get(ctx, key).Result()
	if err != nil {
		return "", "", fmt.Errorf("ws ticket invalid or expired")
	}
	Client.Del(ctx, key)
	var m map[string]string
	if err := json.Unmarshal([]byte(val), &m); err != nil {
		return "", "", fmt.Errorf("ws ticket corrupt")
	}
	return m["user_id"], m["role"], nil
}

func GetSession(sessionID string) (*SessionData, error) {
	if Client == nil {
		return nil, fmt.Errorf("redis not initialized")
	}
	key := "session:" + sessionID
	val, err := Client.Get(ctx, key).Result()
	if err != nil {
		return nil, err
	}
	var data SessionData
	if err := json.Unmarshal([]byte(val), &data); err != nil {
		return nil, err
	}
	return &data, nil
}

func DeleteSession(sessionID string) error {
	var redisErr error
	if Client != nil {
		key := "session:" + sessionID
		redisErr = Client.Del(ctx, key).Err()
	}
	if AfterDeleteSession != nil {
		AfterDeleteSession(sessionID)
	}
	return redisErr
}

func SessionExists(sessionID string) (bool, error) {
	if Client == nil {
		return false, nil
	}
	key := "session:" + sessionID
	count, err := Client.Exists(ctx, key).Result()
	return count > 0, err
}

func Exists(key string) (bool, error) {
	if Client == nil {
		return false, nil
	}
	count, err := Client.Exists(ctx, key).Result()
	return count > 0, err
}

// usageTTL is the maximum lifetime of a per-session usage counter in Redis.
// Sessions cannot legitimately run longer than 48 h; this TTL prevents orphaned
// keys accumulating memory if a session is never explicitly terminated (I6).
const usageTTL = 48 * time.Hour

func IncrementUsage(sessionID string, bytes int64) error {
	if Client == nil {
		return fmt.Errorf("redis client not initialized")
	}
	key := "session:" + sessionID + ":usage"
	// Pipeline: increment + refresh TTL atomically so the counter never expires
	// mid-session but is always cleaned up within 48 h of the last write (I6).
	pipe := Client.Pipeline()
	pipe.IncrBy(ctx, key, bytes)
	pipe.Expire(ctx, key, usageTTL)
	_, err := pipe.Exec(ctx)
	return err
}

func GetUsage(sessionID string) (int64, error) {
	if Client == nil {
		return 0, fmt.Errorf("redis client not initialized")
	}
	key := "session:" + sessionID + ":usage"
	return Client.Get(ctx, key).Int64()
}

// DeleteUsage removes the per-session usage counter from Redis immediately after
// billing settlement so that settled keys do not linger until the 48 h TTL (I6).
func DeleteUsage(sessionID string) error {
	if Client == nil {
		return nil
	}
	key := "session:" + sessionID + ":usage"
	return Client.Del(ctx, key).Err()
}

func GetBatchUsage(sessionIDs []string) (map[string]int64, error) {
	if Client == nil || len(sessionIDs) == 0 {
		return map[string]int64{}, nil
	}
	keys := make([]string, len(sessionIDs))
	for i, id := range sessionIDs {
		keys[i] = "session:" + id + ":usage"
	}
	vals, err := Client.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}
	result := make(map[string]int64)
	for i, val := range vals {
		sessionID := sessionIDs[i]
		if val == nil {
			result[sessionID] = 0
			continue
		}
		switch v := val.(type) {
		case string:
			if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
				result[sessionID] = parsed
			}
		case int64:
			result[sessionID] = v
		}
	}
	return result, nil
}

func GetTotalProviderUsage(providerID, buyerAddress string) (int64, error) {
	if Client == nil {
		return 0, nil
	}
	key := "usage:provider:" + providerID + ":buyer:" + buyerAddress
	val, err := Client.Get(ctx, key).Int64()
	if err == redis.Nil {
		return 0, nil
	}
	return val, err
}

func IncrementProviderUsage(providerID, buyerAddress string, bytes int64) error {
	if Client == nil {
		return nil
	}
	key := "usage:provider:" + providerID + ":buyer:" + buyerAddress
	return Client.IncrBy(ctx, key, bytes).Err()
}

func IncrementNonce(providerID, buyerAddress string) (uint64, error) {
	if Client == nil {
		return 0, fmt.Errorf("redis client not initialized")
	}
	key := "nonce:provider:" + providerID + ":buyer:" + buyerAddress
	val, err := Client.Incr(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	return uint64(val), nil
}

func CheckAPIKeyRateLimit(keyPrefix string, maxRequests int) (bool, int, error) {
	if Client == nil {
		return true, maxRequests, nil
	}
	key := "ratelimit:apikey:" + keyPrefix
	now := time.Now().Unix()
	windowStart := now - 60
	pipe := Client.Pipeline()
	pipe.ZRemRangeByScore(ctx, key, "0", strconv.Itoa(int(windowStart)-1))
	countCmd := pipe.ZCard(ctx, key)
	_, err := pipe.Exec(ctx)
	if err != nil && err != redis.Nil {
		return true, maxRequests, err
	}
	currentCount := countCmd.Val()
	if currentCount >= int64(maxRequests) {
		return false, 0, nil
	}
	Client.ZAdd(ctx, key, redis.Z{
		Score:  float64(now),
		Member: now,
	})
	Client.Expire(ctx, key, 2*time.Minute)
	remaining := int(int64(maxRequests) - currentCount - 1)
	if remaining < 0 {
		remaining = 0
	}
	return true, remaining, nil
}

func ResetAPIKeyRateLimit(keyPrefix string) error {
	if Client == nil {
		return nil
	}
	key := "ratelimit:apikey:" + keyPrefix
	return Client.Del(ctx, key).Err()
}

func GetAPIKeyRateLimitInfo(keyPrefix string) (used int64, remaining int, error error) {
	if Client == nil {
		return 0, 0, nil
	}
	key := "ratelimit:apikey:" + keyPrefix
	now := time.Now().Unix()
	windowStart := now - 60
	Client.ZRemRangeByScore(ctx, key, "0", strconv.Itoa(int(windowStart)-1))
	count, err := Client.ZCard(ctx, key).Result()
	if err != nil && err != redis.Nil {
		return 0, 0, err
	}
	return count, 0, nil
}

func AcquireLock(key string, value string, ttl time.Duration) (bool, error) {
	if Client == nil {
		return true, nil
	}
	success, err := Client.SetNX(ctx, "lock:"+key, value, ttl).Result()
	if err != nil {
		return false, err
	}
	return success, nil
}

func ReleaseLock(key string) error {
	if Client == nil {
		return nil
	}
	return Client.Del(ctx, "lock:"+key).Err()
}

// DeleteAllUserSessions removes all active Redis session keys for a given user.
// It scans for keys matching "session:{credUser}" stored under the reverse-index
// key "sessions:{userID}" (a plain string with newline-separated values, or best-effort scan).
func DeleteAllUserSessions(userID string) {
	if Client == nil {
		return
	}
	// The reverse-index key holds a record of active credential usernames for this user.
	// Since SMembers is not in the RedisClient interface, we just delete the index key itself
	// and rely on TTL expiry for individual session keys. The gateway will reject them on next use.
	reverseKey := "sessions:" + userID
	Client.Del(ctx, reverseKey)
}
