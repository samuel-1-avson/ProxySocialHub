// Package solana — governance on-chain client (GOV-001/002/003).
//
// Proposals are created by the oracle; votes are signed directly by voter
// wallets so the server cannot forge them.
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

var (
	discCreateProposal     = anchorDiscriminator("create_proposal")
	discFinalizeProposal   = anchorDiscriminator("finalize_proposal")
)

// CreateProposalParams holds parameters for creating a governance proposal.
type CreateProposalParams struct {
	ProposalID [16]byte
	Proposer   sol.PublicKey
	TitleHash  [32]byte // SHA-256 of title + description
	EndSlot    uint64
}

// GovernanceProposalData is returned by ReadGovernanceProposal.
type GovernanceProposalData struct {
	ProposalID [16]byte
	Proposer   sol.PublicKey
	TitleHash  [32]byte
	VoteYes    uint64
	VoteNo     uint64
	Status     uint8 // 0=active, 1=passed, 2=rejected, 3=executed
	EndSlot    uint64
	CreatedAt  int64
}

// GetGovernanceProposalPDA derives the PDA for a governance proposal.
func (c *OracleClient) GetGovernanceProposalPDA(proposalID [16]byte) (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{[]byte("gov_proposal"), proposalID[:]},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("GetGovernanceProposalPDA: %w", err)
	}
	return pda, bump, nil
}

// CreateProposalOnChain sends a create_proposal instruction.
// Oracle pays rent. Returns the proposal PDA address and tx signature.
func (c *OracleClient) CreateProposalOnChain(ctx context.Context, params CreateProposalParams) (sol.PublicKey, string, error) {
	proposalPDA, _, err := c.GetGovernanceProposalPDA(params.ProposalID)
	if err != nil {
		return sol.PublicKey{}, "", err
	}

	statePDA, _, _ := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)

	// Data: disc(8) + proposal_id(16) + proposer(32) + title_hash(32) + end_slot(8) = 96
	data := make([]byte, 96)
	copy(data[0:8], discCreateProposal[:])
	copy(data[8:24], params.ProposalID[:])
	copy(data[24:56], params.Proposer.Bytes())
	copy(data[56:88], params.TitleHash[:])
	binary.LittleEndian.PutUint64(data[88:96], params.EndSlot)

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: true},
			{PublicKey: proposalPDA, IsSigner: false, IsWritable: true},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},
		},
		data: data,
	}

	sig, err := c.sendInstruction(ctx, instruction)
	return proposalPDA, sig, err
}

// FinalizeProposalOnChain sends the finalize_proposal instruction (permissionless).
func (c *OracleClient) FinalizeProposalOnChain(ctx context.Context, proposalPDA sol.PublicKey) (string, error) {
	statePDA, _, _ := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)

	// Data: disc(8) = 8 bytes (no args)
	data := make([]byte, 8)
	copy(data[0:8], discFinalizeProposal[:])

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: proposalPDA, IsSigner: false, IsWritable: true},
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},
		},
		data: data,
	}

	return c.sendInstruction(ctx, instruction)
}

// ReadGovernanceProposal fetches and decodes the on-chain GovernanceProposal PDA.
//
// Layout after 8-byte discriminator:
//   [0:16]  proposal_id
//   [16:48] proposer
//   [48:80] title_hash
//   [80:88] vote_yes (u64 LE)
//   [88:96] vote_no  (u64 LE)
//   [96]    status   (u8)
//   [97:105] end_slot (u64 LE)
//   [105:113] created_at (i64 LE)
//   [113]   bump
func (c *OracleClient) ReadGovernanceProposal(ctx context.Context, proposalPDA sol.PublicKey) (*GovernanceProposalData, error) {
	var accountInfo *rpc.GetAccountInfoResult
	if err := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		accountInfo, e = client.GetAccountInfo(ctx, proposalPDA)
		return e
	}); err != nil {
		return nil, fmt.Errorf("ReadGovernanceProposal: %w", err)
	}
	if accountInfo == nil || accountInfo.Value == nil {
		return nil, fmt.Errorf("ReadGovernanceProposal: proposal not found: %s", proposalPDA)
	}

	raw := accountInfo.Value.Data.GetBinary()
	if len(raw) < 114 {
		return nil, fmt.Errorf("ReadGovernanceProposal: data too short")
	}

	body := raw[8:]
	p := &GovernanceProposalData{}
	copy(p.ProposalID[:], body[0:16])
	copy(p.Proposer[:], body[16:48])
	copy(p.TitleHash[:], body[48:80])
	p.VoteYes = binary.LittleEndian.Uint64(body[80:88])
	p.VoteNo = binary.LittleEndian.Uint64(body[88:96])
	p.Status = body[96]
	p.EndSlot = binary.LittleEndian.Uint64(body[97:105])
	p.CreatedAt = int64(binary.LittleEndian.Uint64(body[105:113]))
	return p, nil
}
