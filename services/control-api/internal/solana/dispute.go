// Package solana — dispute / jury on-chain client (DISP-001/002/003/004).
//
// Disputes are opened with a slot-seed VRF so jury selection cannot be
// controlled by the server.  Jury votes are signed directly by juror wallets.
//
// Account orders must match the Anchor context structs in lib.rs.
package solana

import (
	"context"
	"encoding/binary"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

var discOpenDisputeOnchain = anchorDiscriminator("open_dispute_onchain")

// OpenDisputeParams holds parameters for opening a dispute on-chain.
type OpenDisputeParams struct {
	EscrowPDA  sol.PublicKey
	ReasonHash [32]byte // SHA-256 of the dispute reason text
	SlotSeed   uint64   // Recent slot hash as u64 — VRF seed for jury selection
}

// GetDisputeRecordPDA derives the dispute record PDA for an escrow.
func (c *OracleClient) GetDisputeRecordPDA(escrowPDA sol.PublicKey) (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{[]byte("dispute_record"), escrowPDA.Bytes()},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("GetDisputeRecordPDA: %w", err)
	}
	return pda, bump, nil
}

// GetJuryVotePDA derives the jury vote PDA for a juror + dispute.
func (c *OracleClient) GetJuryVotePDA(disputePDA sol.PublicKey, jurorWallet sol.PublicKey) (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{[]byte("jury_vote"), disputePDA.Bytes(), jurorWallet.Bytes()},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("GetJuryVotePDA: %w", err)
	}
	return pda, bump, nil
}

// OpenDisputeOnChain sends an open_dispute_onchain instruction.
// Oracle pays rent.  Returns the dispute record PDA and tx signature.
func (c *OracleClient) OpenDisputeOnChain(ctx context.Context, params OpenDisputeParams) (sol.PublicKey, string, error) {
	disputePDA, _, err := c.GetDisputeRecordPDA(params.EscrowPDA)
	if err != nil {
		return sol.PublicKey{}, "", err
	}

	statePDA, _, _ := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)

	// Data: disc(8) + reason_hash(32) + slot_seed(8) = 48
	data := make([]byte, 48)
	copy(data[0:8], discOpenDisputeOnchain[:])
	copy(data[8:40], params.ReasonHash[:])
	binary.LittleEndian.PutUint64(data[40:48], params.SlotSeed)

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: true}, // oracle
			{PublicKey: params.EscrowPDA, IsSigner: false, IsWritable: false},      // escrow (CHECK)
			{PublicKey: disputePDA, IsSigner: false, IsWritable: true},             // dispute_record
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},   // system_program
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},              // program_state
		},
		data: data,
	}

	sig, err := c.sendInstruction(ctx, instruction)
	return disputePDA, sig, err
}

// DisputeExistsOnChain returns true if a dispute record PDA is initialized.
func (c *OracleClient) DisputeExistsOnChain(ctx context.Context, escrowPDA sol.PublicKey) (bool, error) {
	disputePDA, _, err := c.GetDisputeRecordPDA(escrowPDA)
	if err != nil {
		return false, err
	}

	var found bool
	fetchErr := c.withFailover(ctx, func(client *rpc.Client) error {
		info, e := client.GetAccountInfo(ctx, disputePDA)
		if e != nil {
			return e
		}
		found = info != nil && info.Value != nil
		return nil
	})
	return found, fetchErr
}
