package marketplace

import (
	"crypto/sha256"
	"encoding/hex"
)

// HashCredentialPassword returns a hex-encoded SHA-256 of the proxy password for edge-gateway verification.
func HashCredentialPassword(password string) string {
	sum := sha256.Sum256([]byte(password))
	return hex.EncodeToString(sum[:])
}
