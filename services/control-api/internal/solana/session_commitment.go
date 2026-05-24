// Package solana — session commitment on-chain lock (METER-002).
//
// Locks session parameters (bandwidth limit, price, buyer/seller wallets)
// into an immutable PDA at session creation time.  The edge gateway verifies
// its Redis session cache against this PDA to prevent server-side tampering.
//
// Account order for lock_session_commitment (must match LockSessionCommitment
// context in lib.rs):
//   0  oracle               — Signer, writable (pays rent)
//   1  session_commitment   — init PDA ["session_commitment", session_id_bytes]
//   2  system_program
//   3  program_state        — pause guard
package solana

import (
	"context"
	"encoding/binary"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

var discLockSessionCommitment = anchorDiscriminator("lock_session_commitment")

// LockSessionCommitmentParams holds parameters for creating a session commitment PDA.
type LockSessionCommitmentParams struct {
	// SessionID is the UUID of the session (16 bytes).
	SessionID [16]byte
	// BuyerWallet is the user's linked Solana wallet.
	BuyerWallet sol.PublicKey
	// SellerWallet is the provider's Solana wallet.
	SellerWallet sol.PublicKey
	// BandwidthLimitBytes is the authoritative bandwidth cap for this session.
	BandwidthLimitBytes uint64
	// PricePerGBLamports is the locked-in price at session start.
	PricePerGBLamports uint64
}

// SessionCommitmentData is returned by ReadSessionCommitment.
type SessionCommitmentData struct {
	SessionID            [16]byte
	BuyerWallet          sol.PublicKey
	SellerWallet         sol.PublicKey
	BandwidthLimitBytes  uint64
	PricePerGBLamports   uint64
	LockedAt             int64
}

// GetSessionCommitmentPDA derives the session commitment PDA for a given session UUID.
func (c *OracleClient) GetSessionCommitmentPDA(sessionID [16]byte) (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{[]byte("session_commitment"), sessionID[:]},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("GetSessionCommitmentPDA: %w", err)
	}
	return pda, bump, nil
}

// LockSessionCommitment sends a lock_session_commitment instruction to Solana.
// Called immediately after a session is created in the DB.
// Returns the transaction signature on success.
func (c *OracleClient) LockSessionCommitment(ctx context.Context, params LockSessionCommitmentParams) (string, error) {
	commitPDA, _, err := c.GetSessionCommitmentPDA(params.SessionID)
	if err != nil {
		return "", err
	}

	statePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", fmt.Errorf("LockSessionCommitment: program_state PDA: %w", err)
	}

	// Encode instruction data:
	//   [0:8]   discriminator
	//   [8:24]  session_id ([u8;16])
	//   [24:56] buyer_wallet (Pubkey, 32 bytes)
	//   [56:88] seller_wallet (Pubkey, 32 bytes)
	//   [88:96] bandwidth_limit_bytes (u64 LE)
	//   [96:104] price_per_gb_lamports (u64 LE)
	data := make([]byte, 8+16+32+32+8+8)
	copy(data[0:8], discLockSessionCommitment[:])
	copy(data[8:24], params.SessionID[:])
	copy(data[24:56], params.BuyerWallet.Bytes())
	copy(data[56:88], params.SellerWallet.Bytes())
	binary.LittleEndian.PutUint64(data[88:96], params.BandwidthLimitBytes)
	binary.LittleEndian.PutUint64(data[96:104], params.PricePerGBLamports)

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: true}, // oracle
			{PublicKey: commitPDA, IsSigner: false, IsWritable: true},              // session_commitment
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},   // system_program
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},              // program_state
		},
		data: data,
	}

	return c.sendInstruction(ctx, instruction)
}

// ReadSessionCommitment fetches and decodes the on-chain SessionCommitment PDA.
// Returns an error if the account does not exist.
//
// On-chain layout after 8-byte discriminator:
//   [0:16]  session_id  ([u8;16])
//   [16:48] buyer_wallet (Pubkey)
//   [48:80] seller_wallet (Pubkey)
//   [80:88] bandwidth_limit_bytes (u64 LE)
//   [88:96] price_per_gb_lamports (u64 LE)
//   [96:104] locked_at (i64 LE)
//   [104]   bump (u8)
func (c *OracleClient) ReadSessionCommitment(ctx context.Context, sessionID [16]byte) (*SessionCommitmentData, error) {
	pda, _, err := c.GetSessionCommitmentPDA(sessionID)
	if err != nil {
		return nil, err
	}

	var accountInfo *rpc.GetAccountInfoResult
	fetchErr := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		accountInfo, e = client.GetAccountInfo(ctx, pda)
		return e
	})
	if fetchErr != nil {
		return nil, fmt.Errorf("ReadSessionCommitment: RPC error: %w", fetchErr)
	}
	if accountInfo == nil || accountInfo.Value == nil {
		return nil, fmt.Errorf("ReadSessionCommitment: no commitment found for session")
	}
	raw := accountInfo.Value.Data.GetBinary()

	// Minimum: 8 (disc) + 16 + 32 + 32 + 8 + 8 + 8 + 1 = 113
	if len(raw) < 113 {
		return nil, fmt.Errorf("ReadSessionCommitment: account data too short (%d bytes)", len(raw))
	}

	body := raw[8:]
	sc := &SessionCommitmentData{}
	copy(sc.SessionID[:], body[0:16])
	copy(sc.BuyerWallet[:], body[16:48])
	copy(sc.SellerWallet[:], body[48:80])
	sc.BandwidthLimitBytes = binary.LittleEndian.Uint64(body[80:88])
	sc.PricePerGBLamports = binary.LittleEndian.Uint64(body[88:96])
	sc.LockedAt = int64(binary.LittleEndian.Uint64(body[96:104]))

	return sc, nil
}
