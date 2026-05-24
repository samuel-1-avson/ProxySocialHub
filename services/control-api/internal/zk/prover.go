// Package zk — ZK batch proof generation for ProxyHubb Layer 2.
//
// Architecture
// ──────────────────────────────────────────────────────────────────────────────
// Each 15-minute metering window produces a signed UsageProof (buyer + provider
// Ed25519 signatures).  Phase 4 aggregates N proofs into a single BatchProof
// whose root hash is committed on-chain via one Solana TX instead of N TXes.
//
// Proof structure (Merkle tree):
//   Leaf  = SHA-256(session_id ‖ total_bytes ‖ period_start ‖ period_end ‖ buyer_sig ‖ provider_sig)
//   Root  = merkleRoot(leaves)   — balanced, SHA-256 internal nodes
//
// The root is the only value stored on-chain.  It binds:
//   • Every session included in the batch
//   • Exact byte counts per session
//   • Both parties' signatures
//
// Upgrade path (Phase 5):
//   Replace computeLeaf / merkleRoot with Poseidon hash (ZK-friendly) and
//   generate a Halo2 proof π such that Verify(π, root) = true on-chain.
//   The BatchProof struct is forward-compatible: Proof field is empty for now.
//
// Security note:
//   Until Phase 5 Halo2 proofs are live, the root is a cryptographic commitment
//   (not a zero-knowledge proof).  An auditor can verify inclusion by recomputing
//   the tree from the DB records.  The on-chain root prevents post-hoc tampering.
package zk

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
)

// ProofLeaf is the input data for a single session's proof leaf.
type ProofLeaf struct {
	SessionID    [16]byte // UUID bytes
	TotalBytes   uint64
	PeriodStart  int64
	PeriodEnd    int64
	BuyerSig     []byte // Base58-decoded Ed25519 signature
	ProviderSig  []byte // Base58-decoded Ed25519 signature
}

// BatchProof is the aggregate proof for N sessions.
type BatchProof struct {
	// Root is the Merkle root over all proof leaves.
	Root [32]byte `json:"root"`

	// LeafHashes are the individual leaf hashes (for inclusion proofs / audit).
	LeafHashes [][32]byte `json:"leaf_hashes"`

	// SessionCount is the number of sessions included in this batch.
	SessionCount uint32 `json:"session_count"`

	// TotalBytes is the sum of all session bytes in this batch.
	TotalBytes uint64 `json:"total_bytes"`

	// PeriodStart / PeriodEnd span the entire batch window.
	PeriodStart int64 `json:"period_start"`
	PeriodEnd   int64 `json:"period_end"`

	// Proof is the Halo2/Groth16 proof bytes (empty in Phase 4 — commitment only).
	// Phase 5: populated by the off-chain prover before on-chain submission.
	Proof []byte `json:"proof,omitempty"`
}

// Prover generates ZK batch proofs from a set of usage proof leaves.
type Prover struct{}

func NewProver() *Prover {
	return &Prover{}
}

// GenerateBatchProof computes a BatchProof from the given leaves.
// Returns an error if leaves is empty.
func (p *Prover) GenerateBatchProof(leaves []ProofLeaf) (*BatchProof, error) {
	if len(leaves) == 0 {
		return nil, fmt.Errorf("GenerateBatchProof: no leaves provided")
	}

	leafHashes := make([][32]byte, len(leaves))
	var totalBytes uint64
	var periodStart, periodEnd int64

	for i, leaf := range leaves {
		leafHashes[i] = computeLeaf(leaf)
		totalBytes += leaf.TotalBytes
		if i == 0 || leaf.PeriodStart < periodStart {
			periodStart = leaf.PeriodStart
		}
		if leaf.PeriodEnd > periodEnd {
			periodEnd = leaf.PeriodEnd
		}
	}

	root := merkleRoot(leafHashes)

	return &BatchProof{
		Root:         root,
		LeafHashes:   leafHashes,
		SessionCount: uint32(len(leaves)),
		TotalBytes:   totalBytes,
		PeriodStart:  periodStart,
		PeriodEnd:    periodEnd,
		// Proof is empty until Phase 5 Halo2 integration.
	}, nil
}

// VerifyLeafInclusion checks that a leaf is included in the batch proof.
// Used by auditors or dispute resolution to prove a specific session's data.
func VerifyLeafInclusion(proof *BatchProof, leaf ProofLeaf) bool {
	target := computeLeaf(leaf)
	for _, h := range proof.LeafHashes {
		if h == target {
			return true
		}
	}
	return false
}

// computeLeaf produces the SHA-256 leaf hash for a single proof entry.
// Format: SHA-256(session_id[16] ‖ total_bytes[8 LE] ‖ period_start[8 LE] ‖
//                period_end[8 LE] ‖ buyer_sig ‖ provider_sig)
func computeLeaf(l ProofLeaf) [32]byte {
	h := sha256.New()
	h.Write(l.SessionID[:])

	var buf [8]byte
	binary.LittleEndian.PutUint64(buf[:], l.TotalBytes)
	h.Write(buf[:])
	binary.LittleEndian.PutUint64(buf[:], uint64(l.PeriodStart))
	h.Write(buf[:])
	binary.LittleEndian.PutUint64(buf[:], uint64(l.PeriodEnd))
	h.Write(buf[:])

	h.Write(l.BuyerSig)
	h.Write(l.ProviderSig)

	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

// merkleRoot builds a balanced binary Merkle tree over the given leaf hashes
// and returns the root.  Odd-length levels duplicate the last element.
func merkleRoot(hashes [][32]byte) [32]byte {
	if len(hashes) == 0 {
		return sha256.Sum256(nil)
	}
	if len(hashes) == 1 {
		return hashes[0]
	}

	level := hashes
	for len(level) > 1 {
		var next [][32]byte
		for i := 0; i < len(level); i += 2 {
			left := level[i]
			right := left // duplicate last for odd counts
			if i+1 < len(level) {
				right = level[i+1]
			}
			var parent [32]byte
			h := sha256.New()
			h.Write(left[:])
			h.Write(right[:])
			copy(parent[:], h.Sum(nil))
			next = append(next, parent)
		}
		level = next
	}
	return level[0]
}
