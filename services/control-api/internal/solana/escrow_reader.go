// Package solana — escrow state reader (FIN-002, FIN-004, MISC-001).
//
// Provides methods to read on-chain escrow and usage proof state so that
// payout and settlement paths can verify chain state before disbursing funds.
package solana

import (
	"context"
	"encoding/binary"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

// EscrowOnChainStatus mirrors the EscrowStatus enum in lib.rs.
type EscrowOnChainStatus uint8

const (
	EscrowStatusPending   EscrowOnChainStatus = 0
	EscrowStatusActive    EscrowOnChainStatus = 1
	EscrowStatusSettled   EscrowOnChainStatus = 2
	EscrowStatusRefunded  EscrowOnChainStatus = 3
	EscrowStatusDisputed  EscrowOnChainStatus = 4
	// On chain there is no Expired variant (IDL enum ends at Disputed).
)

// UsageProofOnChainData holds decoded fields from a UsageProofRecord PDA.
type UsageProofOnChainData struct {
	Escrow      sol.PublicKey
	Oracle      sol.PublicKey
	ProofIndex  uint32
	TotalBytes  uint64
	PeriodStart int64
	PeriodEnd   int64
	SubmittedAt int64
}

// ReadEscrowStatusOnChain reads the status byte from an on-chain Escrow account.
// The Escrow layout after the 8-byte discriminator (see escrowStatusOffset):
//   [0:32]  buyer     (Pubkey)
//   [32:64] seller    (Pubkey)
//   [64:72] amount_lamports (u64 LE)
//   [72:80] bandwidth_limit_gb (u64 LE)
//   [80:88] bandwidth_used_gb (u64 LE)
//   [88]    status    (u8, EscrowStatus enum; raw offset 96 with discriminator)
// escrowStatusOffset is the raw-account offset of Escrow.status: after the
// 8-byte discriminator the Anchor/Borsh layout is buyer(32) + seller(32) +
// amount_lamports(8) + bandwidth_limit_gb(8) + bandwidth_used_gb(8), then
// status(1). Verified against the Escrow type in the committed IDL
// (services/solana-programs/proxyhub/idl/proxyhub.json) during P2-ABI-1.
// The previous offset (80) read the low byte of bandwidth_limit_gb.
const escrowStatusOffset = 8 + 32 + 32 + 8 + 8 + 8

// decodeEscrowStatus extracts the status byte from raw Escrow account data.
func decodeEscrowStatus(raw []byte) (EscrowOnChainStatus, error) {
	if len(raw) <= escrowStatusOffset {
		return 0, fmt.Errorf("account data too short (%d)", len(raw))
	}
	return EscrowOnChainStatus(raw[escrowStatusOffset]), nil
}

func (c *OracleClient) ReadEscrowStatusOnChain(ctx context.Context, escrowPDA sol.PublicKey) (EscrowOnChainStatus, error) {
	var accountInfo *rpc.GetAccountInfoResult
	if err := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		accountInfo, e = client.GetAccountInfo(ctx, escrowPDA)
		return e
	}); err != nil {
		return 0, fmt.Errorf("ReadEscrowStatusOnChain: %w", err)
	}
	if accountInfo == nil || accountInfo.Value == nil {
		return 0, fmt.Errorf("ReadEscrowStatusOnChain: escrow account not found: %s", escrowPDA)
	}

	raw := accountInfo.Value.Data.GetBinary()
	// Status sits at escrowStatusOffset; decodeEscrowStatus bounds-checks.
	status, derr := decodeEscrowStatus(raw)
	if derr != nil {
		return 0, fmt.Errorf("ReadEscrowStatusOnChain: %w", derr)
	}

	// status decoded above
	return status, nil
}

// IsEscrowSettled returns true if the escrow is in Settled (2) status.
func (c *OracleClient) IsEscrowSettled(ctx context.Context, escrowPDA sol.PublicKey) (bool, error) {
	status, err := c.ReadEscrowStatusOnChain(ctx, escrowPDA)
	if err != nil {
		return false, err
	}
	return status == EscrowStatusSettled, nil
}

// ReadUsageProof fetches a single UsageProofRecord PDA by escrow and index.
//
// Layout after 8-byte discriminator:
//   [0:32]  escrow       (Pubkey)
//   [32:64] oracle       (Pubkey)
//   [64:68] proof_index  (u32 LE)
//   [68:76] total_bytes  (u64 LE)
//   [76:84] period_start (i64 LE)
//   [84:92] period_end   (i64 LE)
//   [92:100] submitted_at (i64 LE)
//   [100]   bump         (u8)
func (c *OracleClient) ReadUsageProof(ctx context.Context, escrowPDA sol.PublicKey, proofIndex uint32) (*UsageProofOnChainData, error) {
	indexBytes := make([]byte, 4)
	binary.LittleEndian.PutUint32(indexBytes, proofIndex)

	proofPDA, _, err := sol.FindProgramAddress(
		[][]byte{[]byte("usage_proof"), escrowPDA.Bytes(), indexBytes},
		c.programID,
	)
	if err != nil {
		return nil, fmt.Errorf("ReadUsageProof: PDA derivation: %w", err)
	}

	var accountInfo *rpc.GetAccountInfoResult
	if fetchErr := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		accountInfo, e = client.GetAccountInfo(ctx, proofPDA)
		return e
	}); fetchErr != nil {
		return nil, fmt.Errorf("ReadUsageProof: RPC error: %w", fetchErr)
	}
	if accountInfo == nil || accountInfo.Value == nil {
		return nil, nil // No proof at this index — caller checks nil
	}

	raw := accountInfo.Value.Data.GetBinary()
	if len(raw) < 101 {
		return nil, fmt.Errorf("ReadUsageProof: data too short (%d bytes)", len(raw))
	}

	body := raw[8:]
	p := &UsageProofOnChainData{}
	copy(p.Escrow[:], body[0:32])
	copy(p.Oracle[:], body[32:64])
	p.ProofIndex = binary.LittleEndian.Uint32(body[64:68])
	p.TotalBytes = binary.LittleEndian.Uint64(body[68:76])
	p.PeriodStart = int64(binary.LittleEndian.Uint64(body[76:84]))
	p.PeriodEnd = int64(binary.LittleEndian.Uint64(body[84:92]))
	p.SubmittedAt = int64(binary.LittleEndian.Uint64(body[92:100]))
	return p, nil
}

// ReadAllUsageProofs reads all UsageProofRecord PDAs for an escrow, starting at
// index 0, until a missing index is found.  Returns the proofs in order.
func (c *OracleClient) ReadAllUsageProofs(ctx context.Context, escrowPDA sol.PublicKey) ([]UsageProofOnChainData, error) {
	var proofs []UsageProofOnChainData
	for i := uint32(0); i < 1000; i++ { // cap at 1000 to avoid infinite loop
		p, err := c.ReadUsageProof(ctx, escrowPDA, i)
		if err != nil {
			return proofs, fmt.Errorf("ReadAllUsageProofs: index %d: %w", i, err)
		}
		if p == nil {
			break // No more proofs at this index
		}
		proofs = append(proofs, *p)
	}
	return proofs, nil
}

// SumUsageProofBytes sums total_bytes across all on-chain usage proofs for an escrow.
func (c *OracleClient) SumUsageProofBytes(ctx context.Context, escrowPDA sol.PublicKey) (uint64, error) {
	proofs, err := c.ReadAllUsageProofs(ctx, escrowPDA)
	if err != nil {
		return 0, err
	}
	var total uint64
	for _, p := range proofs {
		total += p.TotalBytes
	}
	return total, nil
}
