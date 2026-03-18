package crypto

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

// NewTokenHashFn returns a token hashing function keyed by the given HMAC secret.
// The returned function produces a 64-char hex string (HMAC-SHA256) that fits the
// existing provider_tokens.token varchar(64) column.
//
// Why HMAC-SHA256 instead of plain SHA-256:
//   - Keyed hash: even if the DB is stolen, tokens cannot be brute-forced without
//     knowing the server secret (TOKEN_HMAC_SECRET).
//   - Deterministic: same token + same secret = same hash, so WHERE token = ? still works.
//   - No schema change: output is 64 hex chars, same as the SHA-256 it replaces.
//
// secret must be at least 32 bytes; panic on startup if it is empty.
func NewTokenHashFn(secret string) func(rawToken string) string {
	if secret == "" {
		panic("TOKEN_HMAC_SECRET must not be empty — set it in your environment")
	}
	key := []byte(secret)
	return func(rawToken string) string {
		mac := hmac.New(sha256.New, key)
		mac.Write([]byte(rawToken))
		return hex.EncodeToString(mac.Sum(nil))
	}
}

// ValidateTokenHMACSecret returns an error if the secret is too short.
// Call this at startup to catch misconfiguration early.
func ValidateTokenHMACSecret(secret string) error {
	if len(secret) < 32 {
		return fmt.Errorf(
			"TOKEN_HMAC_SECRET is too short (%d chars); minimum 32 chars required", len(secret))
	}
	return nil
}
