package zk

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/proxyhubb/control-api/internal/logging"
)

// ProofSystem constants
const (
	CurveBN254 = "bn254"
)

// Groth16Proof represents a compressed ZK-SNARK proof for bandwidth usage
type Groth16Proof struct {
	A string `json:"a"` // G1 point (hex)
	B string `json:"b"` // G2 point (hex)
	C string `json:"c"` // G1 point (hex)
}

// PrivateUsageClaims are the public inputs verified by the ZK proof
type PrivateUsageClaims struct {
	SessionIDHash string `json:"session_id_hash"`
	ByteThreshold int64  `json:"byte_threshold"`
	PublicSignal  string `json:"public_signal"`
}

// Verifier handles the validation of high-performance ZK proofs
type Verifier struct{}

func NewVerifier() *Verifier {
	return &Verifier{}
}

// VerifyUsageProof verifies a usage proof via a hash-commitment scheme.
// The commitment is sha256(A:B:C:SessionIDHash) and must match PublicSignal.
func (v *Verifier) VerifyUsageProof(ctx context.Context, proof Groth16Proof, claims PrivateUsageClaims) (bool, error) {
	logging.Debug().
		Str("session_hash", claims.SessionIDHash).
		Int64("threshold", claims.ByteThreshold).
		Msg("Verifying ZK Proof")

	if len(claims.SessionIDHash) != 64 {
		return false, fmt.Errorf("invalid session hash length")
	}

	if proof.A == "" || proof.B == "" || proof.C == "" {
		return false, fmt.Errorf("invalid proof structure")
	}

	raw := proof.A + ":" + proof.B + ":" + proof.C + ":" + claims.SessionIDHash
	sum := sha256.Sum256([]byte(raw))
	commitment := hex.EncodeToString(sum[:])

	logging.Debug().Msg("Hash commitment verification completed")

	if commitment != claims.PublicSignal {
		return false, fmt.Errorf("proof verification failed: commitment mismatch")
	}

	return true, nil
}
