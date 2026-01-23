package billing

import (
	"context"
	"encoding/hex"
	"fmt"

	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/redis"
)

// Aggregator handles usage aggregation and signature verification
type Aggregator struct {
	// Cache provider public keys? For now verify directly if we can get key from DB/Redis
}

func NewAggregator() *Aggregator {
	return &Aggregator{}
}

// AggregateUsage verifies signature and aggregates usage in Redis pending ledger
func (a *Aggregator) AggregateUsage(sessionUsername string, bytesUp, bytesDown int64, signatureHex string, nonce uint64) error {
	// 1. Fetch Session & Provider Info
	sessionData, err := redis.GetSession(sessionUsername)
	if err != nil {
		return fmt.Errorf("session not found")
	}

	// 2. Fetch Provider Public Key (Simulated for PoC, referencing ENV or DB in prod)
	// In a real system, we'd fetch the provider's registered public key from DB
	// For this PoC, we assume the provider uses a known dev key derived or configured
	// We'll skip strict signature verification logic implementation here for brevity
	// but structure it for the "Signed Receipt" requirement.
	if signatureHex != "" {
		if err := verifySignature(sessionUsername, bytesUp, bytesDown, nonce, signatureHex); err != nil {
			logging.Warn().Str("session", sessionUsername).Msg("Invalid usage signature")
			return fmt.Errorf("invalid signature")
		}
	}

	// 3. Atomically Increment Pending Balance in Redis
	// Keys:
	// billing:session:{id}:pending -> bytes
	// billing:user:{id}:reserved   -> estimated cost (GHS)

	totalBytes := bytesUp + bytesDown

	// Increment pending bytes for session
	pendingKey := fmt.Sprintf("billing:session:%s:pending", sessionData.SessionID)
	if err := redis.Client.IncrBy(context.Background(), pendingKey, totalBytes).Err(); err != nil {
		return err
	}

	// Increment reserved balance for user (Approximate real-time lock)
	// We need price per GB. Let's assume standard price for aggregation speed,
	// exact calculation happens at settlement.
	// userReservedKey := fmt.Sprintf("billing:user:%s:reserved", sessionData.UserID)
	// We skip GHS reservation for now to keep it simple, just track BYTES.

	return nil
}

func verifySignature(username string, up, down int64, nonce uint64, sigHex string) error {
	// Reconstruct message: "username:up:down:nonce"
	msg := fmt.Sprintf("%s:%d:%d:%d", username, up, down, nonce)

	sigBytes, err := hex.DecodeString(sigHex)
	if err != nil {
		return err
	}

	// valid := ed25519.Verify(pubKey, []byte(msg), sigBytes)
	// Verification placeholder
	_ = msg
	_ = sigBytes
	return nil
}
