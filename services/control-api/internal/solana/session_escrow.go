// Package solana — Phase 1b prepaid session escrow PDA.
//
// Account order for initialize_session_escrow:
//   0  buyer            — Signer, writable (pays rent + escrow)
//   1  seller           — unchecked
//   2  session_escrow   — init PDA ["session_escrow", session_id]
//   3  system_program
//   4  program_state
//
// Account order for settle_session_escrow:
//   0  oracle           — Signer (must be program_state.admin)
//   1  session_escrow   — mut, close=buyer
//   2  buyer            — mut
//   3  seller           — mut
//   4  program_state
package solana

import (
	"context"
	"encoding/binary"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
	"github.com/proxyhubb/control-api/internal/logging"
)

var (
	discInitializeSessionEscrow = anchorDiscriminator("initialize_session_escrow")
	discSettleSessionEscrow     = anchorDiscriminator("settle_session_escrow")
)

// SessionEscrowData is the on-chain session escrow account (post-discriminator).
type SessionEscrowData struct {
	SessionID           [16]byte
	Buyer               sol.PublicKey
	Seller              sol.PublicKey
	Amount              uint64
	BandwidthLimitBytes uint64
	BytesUsed           uint64
	PricePerGBLamports  uint64
	Status              EscrowStatus
	CreatedAt           int64
	ExpiresAt           int64
	Bump                uint8
}

// SettleSessionEscrowParams holds parameters for oracle settlement.
type SettleSessionEscrowParams struct {
	SessionID [16]byte
	Buyer     sol.PublicKey
	Seller    sol.PublicKey
	BytesUsed uint64
}

// GetSessionEscrowPDA derives ["session_escrow", session_id].
func (c *OracleClient) GetSessionEscrowPDA(sessionID [16]byte) (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{[]byte("session_escrow"), sessionID[:]},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("GetSessionEscrowPDA: %w", err)
	}
	return pda, bump, nil
}

// FetchSessionEscrow reads and decodes a session escrow PDA.
func (c *OracleClient) FetchSessionEscrow(ctx context.Context, escrowPDA sol.PublicKey) (*SessionEscrowData, error) {
	var accountInfo *rpc.GetAccountInfoResult
	err := c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		accountInfo, err = client.GetAccountInfo(ctx, escrowPDA)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("FetchSessionEscrow: %w", err)
	}
	if accountInfo == nil || accountInfo.Value == nil {
		return nil, fmt.Errorf("session escrow account not found")
	}

	data := accountInfo.Value.Data.GetBinary()
	if len(data) < 8 {
		return nil, fmt.Errorf("session escrow data too short")
	}
	data = data[8:] // skip discriminator

	// Layout: session_id(16) buyer(32) seller(32) amount(8) bw_limit(8) bytes_used(8)
	//         price(8) status(1) created(8) expires(8) bump(1) = 129
	const minSize = 16 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 8 + 8 + 1
	if len(data) < minSize {
		return nil, fmt.Errorf("session escrow data too short: got %d need %d", len(data), minSize)
	}

	off := 0
	var sessionID [16]byte
	copy(sessionID[:], data[off:off+16])
	off += 16
	buyer := sol.PublicKeyFromBytes(data[off : off+32])
	off += 32
	seller := sol.PublicKeyFromBytes(data[off : off+32])
	off += 32
	amount := bytesToUint64(data[off : off+8])
	off += 8
	bwLimit := bytesToUint64(data[off : off+8])
	off += 8
	bytesUsed := bytesToUint64(data[off : off+8])
	off += 8
	price := bytesToUint64(data[off : off+8])
	off += 8
	status := EscrowStatus(data[off])
	off++
	createdAt := int64(bytesToUint64(data[off : off+8]))
	off += 8
	expiresAt := int64(bytesToUint64(data[off : off+8]))
	off += 8
	bump := data[off]

	return &SessionEscrowData{
		SessionID:           sessionID,
		Buyer:               buyer,
		Seller:              seller,
		Amount:              amount,
		BandwidthLimitBytes: bwLimit,
		BytesUsed:           bytesUsed,
		PricePerGBLamports:  price,
		Status:              status,
		CreatedAt:           createdAt,
		ExpiresAt:           expiresAt,
		Bump:                bump,
	}, nil
}

// SettleSessionEscrow sends settle_session_escrow (oracle = program admin).
func (c *OracleClient) SettleSessionEscrow(ctx context.Context, source string, params SettleSessionEscrowParams) (string, error) {
	escrowPDA, _, err := c.GetSessionEscrowPDA(params.SessionID)
	if err != nil {
		return "", err
	}
	statePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", fmt.Errorf("SettleSessionEscrow: program_state PDA: %w", err)
	}

	data := make([]byte, 8+8)
	copy(data[0:8], discSettleSessionEscrow[:])
	binary.LittleEndian.PutUint64(data[8:16], params.BytesUsed)

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: false},
			{PublicKey: escrowPDA, IsSigner: false, IsWritable: true},
			{PublicKey: params.Buyer, IsSigner: false, IsWritable: true},
			{PublicKey: params.Seller, IsSigner: false, IsWritable: true},
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},
		},
		data: data,
	}

	logging.Info().
		Str("source", source).
		Str("escrow_pda", escrowPDA.String()).
		Uint64("bytes_used", params.BytesUsed).
		Msg("SettleSessionEscrow attempt")

	sig, err := c.sendInstruction(ctx, instruction)
	recordSettlementTelemetry(source, sig, err)
	if err != nil {
		return "", fmt.Errorf("SettleSessionEscrow: %w", err)
	}
	logging.Info().Str("source", source).Str("tx", sig).Msg("SettleSessionEscrow success")
	return sig, nil
}

// UUIDToSessionIDBytes converts a UUID string (with or without dashes) to [16]byte.
func UUIDToSessionIDBytes(id string) ([16]byte, error) {
	var out [16]byte
	hex := make([]byte, 0, 32)
	for i := 0; i < len(id); i++ {
		c := id[i]
		if c == '-' {
			continue
		}
		hex = append(hex, c)
	}
	if len(hex) != 32 {
		return out, fmt.Errorf("invalid uuid hex length %d", len(hex))
	}
	for i := 0; i < 16; i++ {
		hi, err := fromHexNibble(hex[i*2])
		if err != nil {
			return out, err
		}
		lo, err := fromHexNibble(hex[i*2+1])
		if err != nil {
			return out, err
		}
		out[i] = hi<<4 | lo
	}
	return out, nil
}

func fromHexNibble(c byte) (byte, error) {
	switch {
	case c >= '0' && c <= '9':
		return c - '0', nil
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10, nil
	case c >= 'A' && c <= 'F':
		return c - 'A' + 10, nil
	default:
		return 0, fmt.Errorf("invalid hex nibble %q", c)
	}
}
