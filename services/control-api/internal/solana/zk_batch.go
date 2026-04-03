// Package solana — ZK batch settlement instruction (L2 Phase 4).
//
// submit_zk_batch commits the Merkle root of N session proof leaves to an
// immutable PDA in one Solana TX, replacing N individual submit_usage_proof
// calls.  The root is the SHA-256 Merkle tree computed by zk.Prover.
//
// PDA seeds: [b"zk_batch", batch_root (32 bytes)]
//
// Account order for submit_zk_batch (must match SubmitZKBatch context in lib.rs):
//   0  oracle        — Signer, writable
//   1  zk_batch      — init PDA
//   2  system_program
//   3  program_state — pause guard
package solana

import (
	"context"
	"encoding/binary"
	"encoding/hex"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

var discSubmitZKBatch = anchorDiscriminator("submit_zk_batch")

// ZKBatchParams holds the parameters for a submit_zk_batch instruction.
type ZKBatchParams struct {
	// BatchRoot is the 32-byte Merkle root over all session proof leaves.
	BatchRoot [32]byte
	// SessionCount is the number of sessions covered by this batch.
	SessionCount uint32
	// TotalBytes is the aggregate bandwidth across all sessions.
	TotalBytes uint64
	// PeriodStart / PeriodEnd are Unix timestamps spanning the batch window.
	PeriodStart int64
	PeriodEnd   int64
}

// GetZKBatchPDA derives the PDA for a ZK batch identified by its root hash.
func (c *OracleClient) GetZKBatchPDA(batchRoot [32]byte) (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{[]byte("zk_batch"), batchRoot[:]},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("GetZKBatchPDA: %w", err)
	}
	return pda, bump, nil
}

// SubmitZKBatch sends the submit_zk_batch instruction to Solana, anchoring
// the Merkle root of N session proofs in a single atomic TX.
// Returns the transaction signature and the PDA address.
func (c *OracleClient) SubmitZKBatch(ctx context.Context, params ZKBatchParams) (sig string, batchPDA sol.PublicKey, err error) {
	batchPDA, _, err = c.GetZKBatchPDA(params.BatchRoot)
	if err != nil {
		return "", sol.PublicKey{}, err
	}

	programStatePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatch: program_state PDA: %w", err)
	}

	// Instruction data:
	//   disc(8) + batch_root(32) + session_count(4) + total_bytes(8) +
	//   period_start(8) + period_end(8) = 68 bytes
	data := make([]byte, 8+32+4+8+8+8)
	copy(data[0:8], discSubmitZKBatch[:])
	copy(data[8:40], params.BatchRoot[:])
	binary.LittleEndian.PutUint32(data[40:44], params.SessionCount)
	binary.LittleEndian.PutUint64(data[44:52], params.TotalBytes)
	binary.LittleEndian.PutUint64(data[52:60], uint64(params.PeriodStart))
	binary.LittleEndian.PutUint64(data[60:68], uint64(params.PeriodEnd))

	accounts := []*sol.AccountMeta{
		{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: true},
		{PublicKey: batchPDA, IsSigner: false, IsWritable: true},
		{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		{PublicKey: programStatePDA, IsSigner: false, IsWritable: false},
	}

	txSig, err := c.buildAndSendInstruction(ctx, data, accounts)
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatch: %w", err)
	}
	return txSig, batchPDA, nil
}

// IsZKBatchAnchored returns true if the given batch root has already been
// committed on-chain (idempotency guard — prevents double-submission).
func (c *OracleClient) IsZKBatchAnchored(ctx context.Context, batchRoot [32]byte) (bool, error) {
	batchPDA, _, err := c.GetZKBatchPDA(batchRoot)
	if err != nil {
		return false, err
	}

	var info *rpc.GetAccountInfoResult
	if fetchErr := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		info, e = client.GetAccountInfo(ctx, batchPDA)
		return e
	}); fetchErr != nil {
		return false, fmt.Errorf("IsZKBatchAnchored: RPC error: %w", fetchErr)
	}
	return info != nil && info.Value != nil, nil
}

// ZKBatchRootHex returns the hex-encoded batch root, suitable for DB storage.
func ZKBatchRootHex(root [32]byte) string {
	return hex.EncodeToString(root[:])
}
