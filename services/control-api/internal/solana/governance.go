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
	"os"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
	"github.com/proxyhubb/control-api/internal/decentralization"
)

var (
	discCreateProposal     = anchorDiscriminator("create_proposal")
	discCastGovernanceVote = anchorDiscriminator("cast_governance_vote")
	discFinalizeProposal   = anchorDiscriminator("finalize_proposal")
	discExecuteProposal    = anchorDiscriminator("execute_proposal")
	discEmergencyPause     = anchorDiscriminator("emergency_pause")
	discEmergencyResume    = anchorDiscriminator("emergency_resume")
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

// GovernanceVoteData is returned by ReadGovernanceVote.
type GovernanceVoteData struct {
	Proposal    sol.PublicKey
	Voter       sol.PublicKey
	VoteYes     bool
	VotingPower uint64
	VotedAt     int64
}

// BuildGovernanceVoteTxParams contains arguments for constructing an unsigned
// governance vote transaction to be signed by the voter's wallet.
type BuildGovernanceVoteTxParams struct {
	ProposalPDA sol.PublicKey
	VoterWallet sol.PublicKey
	VoteYes     bool
	VotingPower uint64
}

// BuiltGovernanceVoteTx contains metadata for a client-sign transaction flow.
type BuiltGovernanceVoteTx struct {
	UnsignedTxBase64  string
	GovernanceVotePDA sol.PublicKey
	RecentBlockhash   string
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

// GetGovernanceVotePDA derives the PDA for a voter's vote on a proposal.
func (c *OracleClient) GetGovernanceVotePDA(proposalPDA sol.PublicKey, voterWallet sol.PublicKey) (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{[]byte("gov_vote"), proposalPDA.Bytes(), voterWallet.Bytes()},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("GetGovernanceVotePDA: %w", err)
	}
	return pda, bump, nil
}

// CreateProposalOnChain sends a create_proposal instruction.
// Oracle pays rent. Returns the proposal PDA address and tx signature.
func (c *OracleClient) CreateProposalOnChain(ctx context.Context, params CreateProposalParams) (sol.PublicKey, string, error) {
	oraclePub := c.GetOraclePublicKey()
	if oraclePub.IsZero() {
		return sol.PublicKey{}, "", fmt.Errorf("oracle signer not configured (KMS/local key missing)")
	}

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
			{PublicKey: oraclePub, IsSigner: true, IsWritable: true},
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

// BuildGovernanceVoteTransaction builds an unsigned transaction that clients
// can sign and submit (directly or via relay) for cast_governance_vote.
func (c *OracleClient) BuildGovernanceVoteTransaction(ctx context.Context, params BuildGovernanceVoteTxParams) (*BuiltGovernanceVoteTx, error) {
	votePDA, _, err := c.GetGovernanceVotePDA(params.ProposalPDA, params.VoterWallet)
	if err != nil {
		return nil, err
	}

	statePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return nil, fmt.Errorf("BuildGovernanceVoteTransaction: program_state PDA: %w", err)
	}

	data := make([]byte, 8+1+8)
	copy(data[0:8], discCastGovernanceVote[:])
	if params.VoteYes {
		data[8] = 1
	}
	binary.LittleEndian.PutUint64(data[9:17], params.VotingPower)

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: params.VoterWallet, IsSigner: true, IsWritable: true},
			{PublicKey: params.ProposalPDA, IsSigner: false, IsWritable: true},
			{PublicKey: votePDA, IsSigner: false, IsWritable: true},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},
		},
		data: data,
	}

	var recentBlockhash *rpc.GetLatestBlockhashResult
	if err := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		recentBlockhash, e = client.GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
		return e
	}); err != nil {
		return nil, fmt.Errorf("BuildGovernanceVoteTransaction: blockhash: %w", err)
	}

	tx, err := sol.NewTransaction(
		[]sol.Instruction{instruction},
		recentBlockhash.Value.Blockhash,
		sol.TransactionPayer(params.VoterWallet),
	)
	if err != nil {
		return nil, fmt.Errorf("BuildGovernanceVoteTransaction: build tx: %w", err)
	}

	unsignedTxBase64, err := tx.ToBase64()
	if err != nil {
		return nil, fmt.Errorf("BuildGovernanceVoteTransaction: encode tx: %w", err)
	}

	return &BuiltGovernanceVoteTx{
		UnsignedTxBase64:  unsignedTxBase64,
		GovernanceVotePDA: votePDA,
		RecentBlockhash:   recentBlockhash.Value.Blockhash.String(),
	}, nil
}

// RelaySignedTransactionBase64 relays a fully signed client transaction
// (base64 encoded) to Solana and returns the resulting transaction signature.
//
// Rate-limited public RPCs (e.g. OnFinality) often fail last in the pool and
// would otherwise mask the real preflight error from the primary keyed RPC
// (insufficient SOL, already processed, etc.). Prefer non-rate-limit errors.
func (c *OracleClient) RelaySignedTransactionBase64(ctx context.Context, signedTxBase64 string) (string, error) {
	var (
		sig          sol.Signature
		lastErr      error
		preferredErr error
	)
	n := len(c.rpcClients)
	if n == 0 {
		return "", fmt.Errorf("RelaySignedTransactionBase64: no RPC clients configured")
	}
	for i := 0; i < n; i++ {
		client := c.rpc()
		var callErr error
		sig, callErr = client.SendEncodedTransactionWithOpts(ctx, signedTxBase64, rpc.TransactionOpts{
			SkipPreflight:       false,
			PreflightCommitment: rpc.CommitmentConfirmed,
		})
		if callErr == nil {
			return sig.String(), nil
		}
		lastErr = callErr
		if !isTransientRPCError(callErr) && preferredErr == nil {
			preferredErr = callErr
		}
		backoff := 200 * time.Millisecond
		if isTransientRPCError(callErr) {
			backoff = time.Duration(400*(i+1)) * time.Millisecond
		}
		select {
		case <-ctx.Done():
			if preferredErr != nil {
				return "", fmt.Errorf("RelaySignedTransactionBase64: %w", preferredErr)
			}
			return "", fmt.Errorf("RelaySignedTransactionBase64: %w", lastErr)
		case <-time.After(backoff):
		}
		c.rotateRPC()
	}
	if preferredErr != nil {
		return "", fmt.Errorf("RelaySignedTransactionBase64: %w", preferredErr)
	}
	return "", fmt.Errorf("RelaySignedTransactionBase64: %w", lastErr)
}

// ReadGovernanceProposal fetches and decodes the on-chain GovernanceProposal PDA.
//
// Layout after 8-byte discriminator:
//
//	[0:16]  proposal_id
//	[16:48] proposer
//	[48:80] title_hash
//	[80:88] vote_yes (u64 LE)
//	[88:96] vote_no  (u64 LE)
//	[96]    status   (u8)
//	[97:105] end_slot (u64 LE)
//	[105:113] created_at (i64 LE)
//	[113]   bump
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

// ReadGovernanceVote fetches and decodes the on-chain GovernanceVote PDA.
// Returns (nil, nil) when the vote PDA does not exist for the wallet.
//
// Layout after 8-byte discriminator:
//
//	[0:32]   proposal     (Pubkey)
//	[32:64]  voter        (Pubkey)
//	[64]     vote_yes     (bool)
//	[65:73]  voting_power (u64 LE)
//	[73:81]  voted_at     (i64 LE)
//	[81]     bump         (u8)
func (c *OracleClient) ReadGovernanceVote(ctx context.Context, proposalPDA sol.PublicKey, voterWallet sol.PublicKey) (*GovernanceVoteData, error) {
	votePDA, _, err := c.GetGovernanceVotePDA(proposalPDA, voterWallet)
	if err != nil {
		return nil, err
	}

	var accountInfo *rpc.GetAccountInfoResult
	if err := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		accountInfo, e = client.GetAccountInfoWithOpts(ctx, votePDA, &rpc.GetAccountInfoOpts{
			Commitment: rpc.CommitmentConfirmed,
		})
		return e
	}); err != nil {
		// Some RPC providers surface missing accounts as errors — treat as not-found.
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "not found") || strings.Contains(msg, "could not find") {
			return nil, nil
		}
		return nil, fmt.Errorf("ReadGovernanceVote: %w", err)
	}
	if accountInfo == nil || accountInfo.Value == nil {
		return nil, nil
	}

	raw := accountInfo.Value.Data.GetBinary()
	if len(raw) < 82 {
		return nil, fmt.Errorf("ReadGovernanceVote: data too short")
	}

	body := raw[8:]
	v := &GovernanceVoteData{}
	copy(v.Proposal[:], body[0:32])
	copy(v.Voter[:], body[32:64])
	v.VoteYes = body[64] != 0
	v.VotingPower = binary.LittleEndian.Uint64(body[65:73])
	v.VotedAt = int64(binary.LittleEndian.Uint64(body[73:81]))
	return v, nil
}

// ExecuteProposalOnChain flips a passed proposal to executed after the on-chain
// timelock. It does NOT move SOL — treasury spends stay pending_custody (W4.4).
func (c *OracleClient) ExecuteProposalOnChain(ctx context.Context, proposalPDA sol.PublicKey) (string, error) {
	admin := c.GetOraclePublicKey()
	if admin.IsZero() {
		return "", fmt.Errorf("ExecuteProposalOnChain: oracle/admin signer missing")
	}
	statePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", err
	}
	data := make([]byte, 8)
	copy(data[0:8], discExecuteProposal[:])
	ix := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: proposalPDA, IsSigner: false, IsWritable: true},
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},
			{PublicKey: admin, IsSigner: true, IsWritable: false},
		},
		data: data,
	}
	return c.sendInstructionAsPayer(ctx, ix, admin)
}

// EmergencyPauseOnChain invokes program emergency_pause. Wave 4.4: refused
// unless PROXYHUB_OPS_ONCHAIN_PAUSE=true AND CONFIRM_ONCHAIN_PAUSE=1.
func (c *OracleClient) EmergencyPauseOnChain(ctx context.Context) (string, error) {
	if !decentralization.OpsOnchainPauseEnabled() {
		return "", fmt.Errorf("on-chain pause disabled (PROXYHUB_OPS_ONCHAIN_PAUSE=false)")
	}
	if strings.TrimSpace(os.Getenv("CONFIRM_ONCHAIN_PAUSE")) != "1" {
		return "", fmt.Errorf("on-chain pause requires CONFIRM_ONCHAIN_PAUSE=1")
	}
	admin := c.GetOraclePublicKey()
	statePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", err
	}
	data := make([]byte, 8)
	copy(data[0:8], discEmergencyPause[:])
	ix := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: statePDA, IsSigner: false, IsWritable: true},
			{PublicKey: admin, IsSigner: true, IsWritable: false},
		},
		data: data,
	}
	return c.sendInstructionAsPayer(ctx, ix, admin)
}

// EmergencyResumeOnChain resumes after on-chain pause (same confirm gates).
func (c *OracleClient) EmergencyResumeOnChain(ctx context.Context) (string, error) {
	if !decentralization.OpsOnchainPauseEnabled() {
		return "", fmt.Errorf("on-chain resume disabled (PROXYHUB_OPS_ONCHAIN_PAUSE=false)")
	}
	if strings.TrimSpace(os.Getenv("CONFIRM_ONCHAIN_PAUSE")) != "1" {
		return "", fmt.Errorf("on-chain resume requires CONFIRM_ONCHAIN_PAUSE=1")
	}
	admin := c.GetOraclePublicKey()
	statePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", err
	}
	data := make([]byte, 8)
	copy(data[0:8], discEmergencyResume[:])
	ix := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: statePDA, IsSigner: false, IsWritable: true},
			{PublicKey: admin, IsSigner: true, IsWritable: false},
		},
		data: data,
	}
	return c.sendInstructionAsPayer(ctx, ix, admin)
}
