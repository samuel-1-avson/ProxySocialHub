// Package solana — state channel on-chain instructions (L2 Phase 3).
//
// open_channel  — buyer locks SOL into a PDA vault at channel open.
// close_channel — oracle settles: provider earns spent_lamports, buyer
//                 receives the unspent refund.
//
// PDA seeds: [b"state_channel", session_id (16 bytes)]
//
// Account order for open_channel (must match OpenChannel context in lib.rs):
//   0  buyer            — Signer, writable
//   1  provider_wallet  — read-only (stored in PDA)
//   2  channel          — init PDA
//   3  system_program
//   4  program_state    — pause guard
//
// Account order for close_channel:
//   0  oracle           — Signer, writable (program_state.admin)
//   1  channel          — writable PDA
//   2  provider_wallet  — writable (receives earned lamports)
//   3  buyer            — writable (receives refund)
//   4  system_program
//   5  program_state    — read-only
package solana

import (
	"context"
	"encoding/binary"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

var (
	discOpenChannel  = anchorDiscriminator("open_channel")
	discCloseChannel = anchorDiscriminator("close_channel")
)

// GetChannelPDA derives the PDA for a state channel identified by sessionID.
func (c *OracleClient) GetChannelPDA(sessionID [16]byte) (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{[]byte("state_channel"), sessionID[:]},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("GetChannelPDA: %w", err)
	}
	return pda, bump, nil
}

// buildAndSendInstruction is a shared helper that wraps instruction data +
// accounts into a GenericInstruction, builds a transaction, signs with the
// oracle key, and sends it via the failover RPC pool.
func (c *OracleClient) buildAndSendInstruction(
	ctx context.Context,
	data []byte,
	accounts []*sol.AccountMeta,
) (string, error) {
	instr := &GenericInstruction{
		programID: c.programID,
		accounts:  accounts,
		data:      data,
	}

	var recentBlockhash *rpc.GetLatestBlockhashResult
	if err := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		recentBlockhash, e = client.GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
		return e
	}); err != nil {
		return "", fmt.Errorf("buildAndSendInstruction: blockhash: %w", err)
	}

	tx, err := sol.NewTransaction(
		[]sol.Instruction{instr},
		recentBlockhash.Value.Blockhash,
		sol.TransactionPayer(c.GetOraclePublicKey()),
	)
	if err != nil {
		return "", fmt.Errorf("buildAndSendInstruction: build tx: %w", err)
	}

	if err = c.SignTransaction(ctx, tx); err != nil {
		return "", fmt.Errorf("buildAndSendInstruction: sign: %w", err)
	}

	var sig sol.Signature
	if err = c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		sig, e = client.SendTransaction(ctx, tx)
		return e
	}); err != nil {
		return "", fmt.Errorf("buildAndSendInstruction: send: %w", err)
	}
	return sig.String(), nil
}

// OpenChannelOnChain sends the open_channel instruction, locking depositLamports
// into the channel PDA vault.  The oracle co-signs on behalf of the protocol;
// full buyer-side signing is deferred to Phase 5.
func (c *OracleClient) OpenChannelOnChain(
	ctx context.Context,
	sessionID [16]byte,
	buyer sol.PublicKey,
	provider sol.PublicKey,
	depositLamports uint64,
) (sig string, channelPDA sol.PublicKey, err error) {
	channelPDA, _, err = c.GetChannelPDA(sessionID)
	if err != nil {
		return "", sol.PublicKey{}, err
	}

	programStatePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("OpenChannelOnChain: program_state PDA: %w", err)
	}

	// Instruction data: discriminator (8) + session_id (16) + deposit_lamports (8)
	data := make([]byte, 8+16+8)
	copy(data[0:8], discOpenChannel[:])
	copy(data[8:24], sessionID[:])
	binary.LittleEndian.PutUint64(data[24:32], depositLamports)

	accounts := []*sol.AccountMeta{
		{PublicKey: buyer, IsSigner: true, IsWritable: true},
		{PublicKey: provider, IsSigner: false, IsWritable: false},
		{PublicKey: channelPDA, IsSigner: false, IsWritable: true},
		{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		{PublicKey: programStatePDA, IsSigner: false, IsWritable: false},
	}

	txSig, err := c.buildAndSendInstruction(ctx, data, accounts)
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("OpenChannelOnChain: %w", err)
	}
	return txSig, channelPDA, nil
}

// CloseChannelOnChain settles a state channel on-chain.  The oracle submits
// the final nonce and earned amount; the program pays the provider and refunds
// the buyer atomically.
func (c *OracleClient) CloseChannelOnChain(
	ctx context.Context,
	sessionID [16]byte,
	providerWallet sol.PublicKey,
	buyerWallet sol.PublicKey,
	finalNonce uint64,
	earnedLamports uint64,
) (sig string, err error) {
	channelPDA, _, err := c.GetChannelPDA(sessionID)
	if err != nil {
		return "", err
	}

	programStatePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", fmt.Errorf("CloseChannelOnChain: program_state PDA: %w", err)
	}

	multisigPDA, _, err := sol.FindProgramAddress([][]byte{[]byte("multisig_oracle")}, c.programID)
	if err != nil {
		return "", fmt.Errorf("CloseChannelOnChain: multisig PDA: %w", err)
	}

	// Fetch current multisig nonce
	var nonce uint64 = 0
	multisig := GetMultiSigOracle()
	if multisig != nil && multisig.config != nil {
		nonce = multisig.config.Nonce
	}

	// Format hyphenated UUID representation
	var uuidStr string
	uuidStr = fmt.Sprintf("%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
		sessionID[0], sessionID[1], sessionID[2], sessionID[3],
		sessionID[4], sessionID[5],
		sessionID[6], sessionID[7],
		sessionID[8], sessionID[9],
		sessionID[10], sessionID[11], sessionID[12], sessionID[13], sessionID[14], sessionID[15],
	)

	// Format close message
	msg := fmt.Sprintf("close:%s:%d:%d:%d", uuidStr, finalNonce, earnedLamports, nonce)

	// Sign close message
	sigBytes, err := c.oracleKey.Sign([]byte(msg))
	if err != nil {
		return "", fmt.Errorf("CloseChannelOnChain: sign message: %w", err)
	}
	var signature [64]byte
	copy(signature[:], sigBytes[:])

	// Create Ed25519 precompile instruction
	precompileIx, err := createEd25519Instruction(c.oracleKey.PublicKey(), signature, []byte(msg))
	if err != nil {
		return "", fmt.Errorf("CloseChannelOnChain: create Ed25519 instruction: %w", err)
	}

	// Instruction data: disc(8) + session_id(16) + final_nonce(8) + earned_lamports(8)
	data := make([]byte, 8+16+8+8)
	copy(data[0:8], discCloseChannel[:])
	copy(data[8:24], sessionID[:])
	binary.LittleEndian.PutUint64(data[24:32], finalNonce)
	binary.LittleEndian.PutUint64(data[32:40], earnedLamports)

	accounts := []*sol.AccountMeta{
		{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: true},
		{PublicKey: channelPDA, IsSigner: false, IsWritable: true},
		{PublicKey: providerWallet, IsSigner: false, IsWritable: true},
		{PublicKey: buyerWallet, IsSigner: false, IsWritable: true},
		{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		{PublicKey: programStatePDA, IsSigner: false, IsWritable: false},
		{PublicKey: multisigPDA, IsSigner: false, IsWritable: false},
		{PublicKey: sol.SysVarInstructionsPubkey, IsSigner: false, IsWritable: false},
	}

	instr := &GenericInstruction{
		programID: c.programID,
		accounts:  accounts,
		data:      data,
	}

	// Build and sign transaction
	var recentBlockhash *rpc.GetLatestBlockhashResult
	if err = c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		recentBlockhash, e = client.GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
		return e
	}); err != nil {
		return "", fmt.Errorf("CloseChannelOnChain: blockhash: %w", err)
	}

	tx, err := sol.NewTransaction(
		[]sol.Instruction{precompileIx, instr},
		recentBlockhash.Value.Blockhash,
		sol.TransactionPayer(c.GetOraclePublicKey()),
	)
	if err != nil {
		return "", fmt.Errorf("CloseChannelOnChain: build tx: %w", err)
	}

	if err = c.SignTransaction(ctx, tx); err != nil {
		return "", fmt.Errorf("CloseChannelOnChain: sign: %w", err)
	}

	var txSig sol.Signature
	if err = c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		txSig, e = client.SendTransaction(ctx, tx)
		return e
	}); err != nil {
		return "", fmt.Errorf("CloseChannelOnChain: send: %w", err)
	}
	return txSig.String(), nil
}

// IsChannelOpen returns true if the on-chain channel PDA exists and is not yet closed.
func (c *OracleClient) IsChannelOpen(ctx context.Context, sessionID [16]byte) (bool, error) {
	channelPDA, _, err := c.GetChannelPDA(sessionID)
	if err != nil {
		return false, err
	}

	var info *rpc.GetAccountInfoResult
	if fetchErr := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		info, e = client.GetAccountInfo(ctx, channelPDA)
		return e
	}); fetchErr != nil {
		return false, fmt.Errorf("IsChannelOpen: RPC error: %w", fetchErr)
	}
	if info == nil || info.Value == nil {
		return false, nil // PDA does not exist
	}

	raw := info.Value.Data.GetBinary()
	// Layout (after 8-byte disc):
	//   session_id(16) + buyer(32) + provider(32) + deposit(8) + spent(8) + nonce(8)
	//   + opened_at(8) + expires_at(8) = 120 bytes body → is_closed at offset 8+120=128
	if len(raw) < 130 {
		return false, fmt.Errorf("IsChannelOpen: unexpected account size %d", len(raw))
	}
	isClosed := raw[128] != 0
	return !isClosed, nil
}
