// Package solana — BC-11-B Groth16 batch submit client.
//
// Sends submit_zk_batch_groth16 when decentralization.ZKOnchainGroth16Ready().
// Program must be built with Cargo feature onchain-groth16 and matching VK.
package solana

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"

	"github.com/proxyhubb/control-api/internal/decentralization"
)

var discSubmitZKBatchGroth16 = anchorDiscriminator("submit_zk_batch_groth16")

// BatchGroth16VKHashHex is SHA-256 of the canonical BE verifying-key bytes
// embedded in the proxyhub program (tools/gen-batch-vk). Must match on-chain VK_HASH.
const BatchGroth16VKHashHex = "2f1075c22786a7763bfaee9ec39188b2aec7fb19de0aa1c3aac9e7ce29519e72"

// BatchGroth16VKHash returns the 32-byte VK commitment expected by submit_zk_batch_groth16.
func BatchGroth16VKHash() [32]byte {
	var out [32]byte
	b, err := hex.DecodeString(BatchGroth16VKHashHex)
	if err != nil || len(b) != 32 {
		return out
	}
	copy(out[:], b)
	return out
}

// ZKBatchGroth16Params extends oracle batch params with VK hash + proof.
type ZKBatchGroth16Params struct {
	ZKBatchParams
	// LeavesHash is SHA256(leaf_0‖…‖leaf_n-1) for Wave 5.A digest-v2 (required, non-zero).
	LeavesHash [32]byte
	// VKHash is SHA-256 of the canonical verifying key bytes expected on-chain.
	// Zero means use BatchGroth16VKHash().
	VKHash [32]byte
	// Proof is 256 bytes A||B||C (A pre-negated, big-endian). Required for submit.
	Proof [256]byte
	// ProofAccount optional; if set and on-chain data is 256 bytes it overrides Proof.
	ProofAccount sol.PublicKey
	// VKAccount optionally pins VK_HASH in its first 32 bytes (may be system program / empty).
	VKAccount sol.PublicKey
}

// EncodeSubmitZKBatchGroth16Data builds Anchor instruction data.
// Layout: disc(8) + root(32) + session_count(4) + total_bytes(8) +
// period_start(8) + period_end(8) + leaves_hash(32) + proof_hash(32) + vk_hash(32) + proof(256) = 420 bytes.
func EncodeSubmitZKBatchGroth16Data(params ZKBatchGroth16Params) []byte {
	vk := params.VKHash
	if vk == ([32]byte{}) {
		vk = BatchGroth16VKHash()
	}
	data := make([]byte, 8+32+4+8+8+8+32+32+32+256)
	copy(data[0:8], discSubmitZKBatchGroth16[:])
	copy(data[8:40], params.BatchRoot[:])
	binary.LittleEndian.PutUint32(data[40:44], params.SessionCount)
	binary.LittleEndian.PutUint64(data[44:52], params.TotalBytes)
	binary.LittleEndian.PutUint64(data[52:60], uint64(params.PeriodStart))
	binary.LittleEndian.PutUint64(data[60:68], uint64(params.PeriodEnd))
	copy(data[68:100], params.LeavesHash[:])
	copy(data[100:132], params.ProofHash[:])
	copy(data[132:164], vk[:])
	copy(data[164:420], params.Proof[:])
	return data
}

// SubmitZKBatchGroth16 verifies-on-chain path: require ready gate, then send ix.
func (c *OracleClient) SubmitZKBatchGroth16(ctx context.Context, params ZKBatchGroth16Params) (sig string, batchPDA sol.PublicKey, err error) {
	if err := decentralization.GateOnchainGroth16Settlement(); err != nil {
		return "", sol.PublicKey{}, err
	}
	if !decentralization.ZKOnchainGroth16Ready() {
		return "", sol.PublicKey{}, decentralization.ErrOnchainGroth16NotReady
	}
	if params.Proof == ([256]byte{}) && params.ProofAccount.IsZero() {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatchGroth16: Proof or ProofAccount required")
	}
	if params.LeavesHash == ([32]byte{}) {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatchGroth16: LeavesHash required (digest-v2)")
	}
	if params.VKAccount.IsZero() {
		programStatePDA, _, e := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
		if e != nil {
			return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatchGroth16: program_state PDA: %w", e)
		}
		params.VKAccount = programStatePDA
	}
	if params.ProofAccount.IsZero() {
		params.ProofAccount = sol.SystemProgramID
	}
	if params.ProofHash == ([32]byte{}) && params.Proof != ([256]byte{}) {
		params.ProofHash = sha256.Sum256(params.Proof[:])
	}

	batchPDA, _, err = c.GetZKBatchPDA(params.BatchRoot)
	if err != nil {
		return "", sol.PublicKey{}, err
	}

	programStatePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatchGroth16: program_state PDA: %w", err)
	}

	oraclePK := c.GetOraclePublicKey()
	data := EncodeSubmitZKBatchGroth16Data(params)
	accounts := []*sol.AccountMeta{
		{PublicKey: oraclePK, IsSigner: true, IsWritable: true},
		{PublicKey: batchPDA, IsSigner: false, IsWritable: true},
		{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		{PublicKey: programStatePDA, IsSigner: false, IsWritable: false},
		{PublicKey: params.ProofAccount, IsSigner: false, IsWritable: false},
		{PublicKey: params.VKAccount, IsSigner: false, IsWritable: false},
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
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatchGroth16: blockhash: %w", err)
	}

	tx, err := sol.NewTransaction(
		[]sol.Instruction{instr},
		recentBlockhash.Value.Blockhash,
		sol.TransactionPayer(oraclePK),
	)
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatchGroth16: build tx: %w", err)
	}

	if err = c.SignTransaction(ctx, tx); err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatchGroth16: sign tx: %w", err)
	}

	var txSig sol.Signature
	if err = c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		txSig, e = client.SendTransaction(ctx, tx)
		return e
	}); err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatchGroth16: send: %w", err)
	}
	return txSig.String(), batchPDA, nil
}
