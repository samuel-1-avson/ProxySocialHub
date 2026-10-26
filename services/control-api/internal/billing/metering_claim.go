package billing

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
	goredis "github.com/redis/go-redis/v9"
)

// W-16: durable metering claims.
//
// settle flow: owner-tokened lock -> atomic GETDEL of the pending-bytes
// (and price-snapshot) keys -> durable usage_metering_claims row -> money
// tx marks the claim settled in the SAME transaction. Any failure after
// the claim requeues the bytes from the row; a sweeper requeues claims
// whose settler died. Bytes can no longer be lost between GET and DEL,
// nor by a DB rollback after DEL.

const staleClaimAfter = 10 * time.Minute

var releaseLockScript = goredis.NewScript(`
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`)

// acquireSettleLock takes the per-session settle lock with an owner
// token; release only deletes our own lock (W-16: the old unconditional
// DEL could delete the next owner's lock after TTL expiry).
func acquireSettleLock(sessionID string) (string, bool) {
	if redis.Client == nil {
		return "", true // single-process/test mode without Redis locks
	}
	token := uuid.NewString()
	ok, err := redis.Client.SetNX(context.Background(), "billing:settle-lock:"+sessionID, token, settleLockTTL).Result()
	if err != nil || !ok {
		return "", false
	}
	return token, true
}

func releaseSettleLock(sessionID, token string) {
	if redis.Client == nil || token == "" {
		return
	}
	_ = releaseLockScript.Run(context.Background(), redis.Client, []string{"billing:settle-lock:" + sessionID}, token).Err()
}

func pendingKeyForSession(sessionID string) string {
	return "billing:session:" + sessionID + ":pending"
}

// peekPendingBytes reads (without consuming) the pending byte count.
func peekPendingBytes(redisKey string, fallback int64) int64 {
	if redis.Client == nil {
		return fallback
	}
	v, err := redis.Client.Get(context.Background(), redisKey).Result()
	if err != nil {
		return fallback
	}
	if n, perr := strconv.ParseInt(strings.TrimSpace(v), 10, 64); perr == nil {
		return n
	}
	return fallback
}

// claimSessionUsage atomically takes the pending bytes out of Redis and
// records them durably. fallbackBytes is used only when Redis has no key
// (direct-call paths/tests); solPrice is the pre-resolved settle price.
// Returns (nil, nil) when there is nothing to settle. On DB failure the
// Redis keys are restored before returning the error.
func claimSessionUsage(sessionID, redisKey string, fallbackBytes int64, solPrice float64) (*models.UsageMeteringClaim, error) {
	sid, err := uuid.Parse(sessionID)
	if err != nil {
		return nil, fmt.Errorf("claim usage: bad session id: %w", err)
	}
	bytesN := fallbackBytes
	var snapshot *float64
	if redis.Client != nil {
		ctx := context.Background()
		if v, gerr := redis.Client.GetDel(ctx, redisKey).Result(); gerr == nil {
			if n, perr := strconv.ParseInt(strings.TrimSpace(v), 10, 64); perr == nil {
				bytesN = n
			}
		} else if gerr != goredis.Nil {
			return nil, fmt.Errorf("claim usage: GETDEL pending: %w", gerr)
		}
		if v, gerr := redis.Client.GetDel(ctx, PriceSnapshotKeyForPendingKey(redisKey)).Result(); gerr == nil {
			if f, perr := strconv.ParseFloat(strings.TrimSpace(v), 64); perr == nil && f > 0 {
				snapshot = &f
			}
		}
	}
	if bytesN <= 0 {
		return nil, nil
	}
	price := snapshot
	if price == nil && solPrice > 0 {
		p := solPrice
		price = &p
	}
	claim := &models.UsageMeteringClaim{
		SessionID:   sid,
		Bytes:       bytesN,
		SOLPriceUSD: price,
		Status:      models.MeteringClaimClaimed,
	}
	if err := db.DB.Create(claim).Error; err != nil {
		restoreClaimedKeys(redisKey, bytesN, snapshot)
		return nil, fmt.Errorf("claim usage: insert claim: %w", err)
	}
	return claim, nil
}

// restoreClaimedKeys puts claimed bytes/snapshot back into Redis.
func restoreClaimedKeys(redisKey string, bytesN int64, snapshot *float64) {
	if redis.Client == nil {
		return
	}
	ctx := context.Background()
	_ = redis.Client.IncrBy(ctx, redisKey, bytesN).Err()
	if snapshot != nil {
		_ = redis.Client.SetNX(ctx, PriceSnapshotKeyForPendingKey(redisKey), *snapshot, 0).Err()
	}
}

// requeueClaim returns a failed claim's bytes to the pending key exactly
// once (guarded by the claimed->requeued transition).
func requeueClaim(claim *models.UsageMeteringClaim, cause error) {
	if claim == nil {
		return
	}
	res := db.DB.Model(&models.UsageMeteringClaim{}).
		Where("id = ? AND status = ?", claim.ID, models.MeteringClaimClaimed).
		Updates(map[string]interface{}{
			"status":     models.MeteringClaimRequeued,
			"last_error": fmt.Sprintf("%v", cause),
		})
	if res.Error != nil {
		logging.Error(res.Error).Str("claim_id", claim.ID.String()).Msg("CRITICAL: metering claim requeue status update failed; sweeper will retry")
		return
	}
	if res.RowsAffected == 0 {
		return // already settled/requeued by someone else
	}
	restoreClaimedKeys(pendingKeyForSession(claim.SessionID.String()), claim.Bytes, claim.SOLPriceUSD)
	logging.Warn().Str("claim_id", claim.ID.String()).Str("session_id", claim.SessionID.String()).
		Int64("bytes", claim.Bytes).Msg("billing: metering claim requeued after settle failure")
}

// consumeExternalClaim claims the bytes and immediately marks them
// consumed by an external (on-chain escrow/PDA) settlement path.
func consumeExternalClaim(sessionID, redisKey string, fallbackBytes int64) error {
	claim, err := claimSessionUsage(sessionID, redisKey, fallbackBytes, 0)
	if err != nil {
		return err
	}
	if claim == nil {
		return nil
	}
	now := time.Now().UTC()
	return db.DB.Model(&models.UsageMeteringClaim{}).
		Where("id = ? AND status = ?", claim.ID, models.MeteringClaimClaimed).
		Updates(map[string]interface{}{
			"status":     models.MeteringClaimExternal,
			"settled_at": now,
		}).Error
}

// sweepStaleMeteringClaims requeues claims whose settler died mid-flight.
func sweepStaleMeteringClaims() {
	if db.DB == nil {
		return
	}
	var stale []models.UsageMeteringClaim
	if err := db.DB.Where("status = ? AND created_at < ?", models.MeteringClaimClaimed, time.Now().UTC().Add(-staleClaimAfter)).
		Limit(100).Find(&stale).Error; err != nil {
		logging.Warn().Err(err).Msg("billing: stale metering claim sweep query failed")
		return
	}
	for i := range stale {
		requeueClaim(&stale[i], fmt.Errorf("stale claim sweeper: claimed > %s ago", staleClaimAfter))
	}
}
