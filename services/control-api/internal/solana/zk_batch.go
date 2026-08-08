// Package solana — ZK batch settlement instruction (L2 Phase 4 / BC-11).
//
// submit_zk_batch commits the Merkle root of N session proof leaves to an
// immutable PDA in one Solana TX, replacing N individual submit_usage_proof
// calls. The root is the SHA-256 Merkle tree computed by zk.Prover.
//
// On-chain today (BC-11 Phase-1):
//   - Preceding Ed25519 precompile must verify oracle signature over batch_root
//   - proof_hash is stored as SHA-256(off-chain Halo2/proof blob) when present;
//     zeros means "no off-chain proof attached" (dev / optional prover)
//   - Halo2 verification is NOT performed on-chain yet (XL follow-up)
//
// PDA seeds: [b"zk_batch", batch_root (32 bytes)]
//
// Account order for submit_zk_batch (must match SubmitZKBatch in lib.rs):
//   0  oracle        — Signer, writable
//   1  zk_batch      — init PDA
//   2  system_program
//   3  program_state — pause guard
//   4  instructions  — sysvar (Ed25519 introspection)
package solana

import (
	"context"
	"crypto/sha256"
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
	// ProofHash is SHA-256 of the off-chain ZK proof blob (zeros if none).
	ProofHash [32]byte
}

// ProofHashFromBytes returns SHA-256(proof) or zeros when proof is empty.
func ProofHashFromBytes(proof []byte) [32]byte {
	var out [32]byte
	if len(proof) == 0 {
		return out
	}
	sum := sha256.Sum256(proof)
	return sum
}

// EncodeSubmitZKBatchData builds Anchor instruction data for submit_zk_batch.
// Layout: disc(8) + root(32) + session_count(4) + total_bytes(8) +
// period_start(8) + period_end(8) + proof_hash(32) = 100 bytes.
func EncodeSubmitZKBatchData(params ZKBatchParams) []byte {
	data := make([]byte, 8+32+4+8+8+8+32)
	copy(data[0:8], discSubmitZKBatch[:])
	copy(data[8:40], params.BatchRoot[:])
	binary.LittleEndian.PutUint32(data[40:44], params.SessionCount)
	binary.LittleEndian.PutUint64(data[44:52], params.TotalBytes)
	binary.LittleEndian.PutUint64(data[52:60], uint64(params.PeriodStart))
	binary.LittleEndian.PutUint64(data[60:68], uint64(params.PeriodEnd))
	copy(data[68:100], params.ProofHash[:])
	return data
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

// SubmitZKBatch sends Ed25519(precompile over batch_root) + submit_zk_batch,
// anchoring the Merkle root (and optional proof_hash) in one atomic TX.
func (c *OracleClient) SubmitZKBatch(ctx context.Context, params ZKBatchParams) (sig string, batchPDA sol.PublicKey, err error) {
	batchPDA, _, err = c.GetZKBatchPDA(params.BatchRoot)
	if err != nil {
		return "", sol.PublicKey{}, err
	}

	programStatePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatch: program_state PDA: %w", err)
	}

	oraclePK := c.GetOraclePublicKey()
	sigBytes, err := c.SignMessage(ctx, params.BatchRoot[:])
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatch: sign batch_root: %w", err)
	}
	if len(sigBytes) != 64 {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatch: oracle signature length %d, want 64", len(sigBytes))
	}
	var signature [64]byte
	copy(signature[:], sigBytes)

	precompileIx, err := createEd25519Instruction(oraclePK, signature, params.BatchRoot[:])
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatch: ed25519 ix: %w", err)
	}

	data := EncodeSubmitZKBatchData(params)
	accounts := []*sol.AccountMeta{
		{PublicKey: oraclePK, IsSigner: true, IsWritable: true},
		{PublicKey: batchPDA, IsSigner: false, IsWritable: true},
		{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		{PublicKey: programStatePDA, IsSigner: false, IsWritable: false},
		{PublicKey: sol.SysVarInstructionsPubkey, IsSigner: false, IsWritable: false},
	}

	instr := &GenericInstruction{
		programID: c.programID,
		accounts:  accounts,
		data:      data,
	}

	var recentBlockhash *rpc.GetLatestBlockhashResult
	if err = c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		recentBlockhash, e = client.GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
		return e
	}); err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatch: blockhash: %w", err)
	}

	tx, err := sol.NewTransaction(
		[]sol.Instruction{precompileIx, instr},
		recentBlockhash.Value.Blockhash,
		sol.TransactionPayer(oraclePK),
	)
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatch: build tx: %w", err)
	}

	if err = c.SignTransaction(ctx, tx); err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatch: sign tx: %w", err)
	}

	var txSig sol.Signature
	if err = c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		txSig, e = client.SendTransaction(ctx, tx)
		return e
	}); err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatch: send: %w", err)
	}
	return txSig.String(), batchPDA, nil
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
