// Package solana - settlement transaction builder
package solana

import (
	"context"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

// SettleEscrowParams contains the parameters for settling an escrow
type SettleEscrowParams struct {
	// Buyer public key (for refund)
	Buyer sol.PublicKey
	// Seller public key (for payment)
	Seller sol.PublicKey
	// Escrow PDA address
	EscrowPDA sol.PublicKey
	// Bandwidth used in GB
	BandwidthUsedGB uint64
}

// SubmitUsageProofParams contains parameters for submitting a usage proof
type SubmitUsageProofParams struct {
	EscrowPDA   sol.PublicKey
	ProofIndex  uint32
	TotalBytes  uint64
	PeriodStart int64
	PeriodEnd   int64
}

// SettleEscrow creates and sends a settle_escrow transaction
// This transfers funds proportionally: used portion to seller, remainder to buyer
func (c *OracleClient) SettleEscrow(ctx context.Context, params SettleEscrowParams) (string, error) {
	// Build the settle_escrow instruction
	instruction := c.buildSettleInstruction(params)

	// Get recent blockhash
	var recentBlockhash *rpc.GetLatestBlockhashResult
	err := c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		recentBlockhash, err = client.GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
		return err
	})
	if err != nil {
		return "", fmt.Errorf("failed to get recent blockhash: %w", err)
	}

	// Build transaction
	tx, err := sol.NewTransaction(
		[]sol.Instruction{instruction},
		recentBlockhash.Value.Blockhash,
		sol.TransactionPayer(c.oracleKey.PublicKey()),
	)
	if err != nil {
		return "", fmt.Errorf("failed to build transaction: %w", err)
	}

	// Sign transaction with oracle key
	_, err = tx.Sign(func(key sol.PublicKey) *sol.PrivateKey {
		if key.Equals(c.oracleKey.PublicKey()) {
			return &c.oracleKey
		}
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("failed to sign transaction: %w", err)
	}

	// Send transaction
	var sig sol.Signature
	err = c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		sig, err = client.SendTransaction(ctx, tx)
		return err
	})
	if err != nil {
		return "", fmt.Errorf("failed to send transaction: %w", err)
	}

	return sig.String(), nil
}

// BatchSettleEscrows builds and sends a transaction with multiple settle_escrow instructions
func (c *OracleClient) BatchSettleEscrows(ctx context.Context, batch []SettleEscrowParams) (string, error) {
	if len(batch) == 0 {
		return "", fmt.Errorf("empty batch")
	}

	instructions := make([]sol.Instruction, len(batch))
	for i, params := range batch {
		instructions[i] = c.buildSettleInstruction(params)
	}

	// Get recent blockhash
	var recentBlockhash *rpc.GetLatestBlockhashResult
	err := c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		recentBlockhash, err = client.GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
		return err
	})
	if err != nil {
		return "", fmt.Errorf("failed to get recent blockhash: %w", err)
	}

	// Build transaction with all instructions
	tx, err := sol.NewTransaction(
		instructions,
		recentBlockhash.Value.Blockhash,
		sol.TransactionPayer(c.oracleKey.PublicKey()),
	)
	if err != nil {
		return "", fmt.Errorf("failed to build batch transaction: %w", err)
	}

	// Sign transaction
	_, err = tx.Sign(func(key sol.PublicKey) *sol.PrivateKey {
		if key.Equals(c.oracleKey.PublicKey()) {
			return &c.oracleKey
		}
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("failed to sign batch transaction: %w", err)
	}

	// Send transaction
	var sig sol.Signature
	err = c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		sig, err = client.SendTransaction(ctx, tx)
		return err
	})
	if err != nil {
		return "", fmt.Errorf("failed to send batch transaction: %w", err)
	}

	return sig.String(), nil
}

// buildSettleInstruction creates the settle_escrow instruction
func (c *OracleClient) buildSettleInstruction(params SettleEscrowParams) sol.Instruction {
	// Instruction discriminator for "settle_escrow" (first 8 bytes of sha256("global:settle_escrow"))
	discriminator := []byte{181, 46, 143, 119, 192, 200, 127, 167}

	// Encode bandwidth_used_gb as little-endian u64
	data := make([]byte, 8+8) // discriminator + u64
	copy(data[0:8], discriminator)
	for i := 0; i < 8; i++ {
		data[8+i] = byte(params.BandwidthUsedGB >> (8 * i))
	}

	return &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: false}, // oracle
			{PublicKey: params.EscrowPDA, IsSigner: false, IsWritable: true},        // escrow
			{PublicKey: params.Buyer, IsSigner: false, IsWritable: true},            // buyer
			{PublicKey: params.Seller, IsSigner: false, IsWritable: true},           // seller
		},
		data: data,
	}
}

// EmergencyRefund executes an emergency refund after timeout
func (c *OracleClient) EmergencyRefund(ctx context.Context, params RefundEscrowParams) (string, error) {
	// Instruction discriminator for "emergency_refund"
	discriminator := []byte{119, 215, 203, 76, 12, 10, 205, 59}

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: params.Buyer, IsSigner: true, IsWritable: true},
			{PublicKey: params.EscrowPDA, IsSigner: false, IsWritable: true},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		},
		data: discriminator,
	}

	// This would be signed by the buyer, but for testing we use oracle if it has authority
	// In production, the frontend handles buyer signing.
	return c.sendInstruction(ctx, instruction)
}

// SlashStakeParams contains parameters for slashing
type SlashStakeParams struct {
	ProviderWallet sol.PublicKey
	Amount         uint64
}

// SlashStake executes a slash_stake instruction
func (c *OracleClient) SlashStake(ctx context.Context, params SlashStakeParams) (string, error) {
	// Instruction discriminator for "slash_stake"
	discriminator := []byte{216, 57, 137, 237, 208, 127, 26, 172}

	stakePDA, _, _ := sol.FindProgramAddress(
		[][]byte{[]byte("stake"), params.ProviderWallet.Bytes()},
		c.programID,
	)

	adminConfigPDA, _, _ := sol.FindProgramAddress(
		[][]byte{[]byte("admin_config")},
		c.programID,
	)

	// Encode amount
	data := make([]byte, 8+8)
	copy(data[0:8], discriminator)
	for i := 0; i < 8; i++ {
		data[8+i] = byte(params.Amount >> (8 * i))
	}

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: false}, // admin
			{PublicKey: stakePDA, IsSigner: false, IsWritable: true},
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: false, IsWritable: true}, // oracle_wallet (payout)
			{PublicKey: adminConfigPDA, IsSigner: false, IsWritable: false},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		},
		data: data,
	}

	return c.sendInstruction(ctx, instruction)
}

// SubmitUsageProof executes a submit_usage_proof instruction
func (c *OracleClient) SubmitUsageProof(ctx context.Context, params SubmitUsageProofParams) (string, error) {
	// Instruction discriminator for "submit_usage_proof"
	discriminator := []byte{142, 105, 140, 164, 42, 63, 114, 219}

	usageProofPDA, _, _ := sol.FindProgramAddress(
		[][]byte{
			[]byte("usage_proof"),
			params.EscrowPDA.Bytes(),
			{byte(params.ProofIndex), byte(params.ProofIndex >> 8), byte(params.ProofIndex >> 16), byte(params.ProofIndex >> 24)},
		},
		c.programID,
	)

	// Encode data (Disc + index(u32) + bytes(u64) + start(i64) + end(i64))
	data := make([]byte, 8+4+8+8+8)
	copy(data[0:8], discriminator)
	for i := 0; i < 4; i++ {
		data[8+i] = byte(params.ProofIndex >> (8 * i))
	}
	for i := 0; i < 8; i++ {
		data[12+i] = byte(params.TotalBytes >> (8 * i))
	}
	for i := 0; i < 8; i++ {
		data[20+i] = byte(uint64(params.PeriodStart) >> (8 * i))
	}
	for i := 0; i < 8; i++ {
		data[28+i] = byte(uint64(params.PeriodEnd) >> (8 * i))
	}

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: true}, // submitter
			{PublicKey: params.EscrowPDA, IsSigner: false, IsWritable: true},
			{PublicKey: usageProofPDA, IsSigner: false, IsWritable: true},
			{PublicKey: sol.SysVarInstructionsPubkey, IsSigner: false, IsWritable: false},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		},
		data: data,
	}

	return c.sendInstruction(ctx, instruction)
}

// sendInstruction is a helper to sign and send an instruction
func (c *OracleClient) sendInstruction(ctx context.Context, instruction sol.Instruction) (string, error) {
	var recentBlockhash *rpc.GetLatestBlockhashResult
	err := c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		recentBlockhash, err = client.GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
		return err
	})
	if err != nil {
		return "", err
	}

	tx, err := sol.NewTransaction([]sol.Instruction{instruction}, recentBlockhash.Value.Blockhash, sol.TransactionPayer(c.oracleKey.PublicKey()))
	if err != nil {
		return "", err
	}

	_, err = tx.Sign(func(key sol.PublicKey) *sol.PrivateKey {
		if key.Equals(c.oracleKey.PublicKey()) {
			return &c.oracleKey
		}
		return nil
	})
	if err != nil {
		return "", err
	}

	var sig sol.Signature
	err = c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		sig, err = client.SendTransaction(ctx, tx)
		return err
	})
	if err != nil {
		return "", err
	}

	return sig.String(), nil
}

// RefundEscrowParams contains the parameters for refunding an escrow
type RefundEscrowParams struct {
	// Buyer public key (must sign)
	Buyer sol.PublicKey
	// Escrow PDA address
	EscrowPDA sol.PublicKey
}

// CheckEscrowStatus checks the on-chain status of an escrow
func (c *OracleClient) CheckEscrowStatus(ctx context.Context, buyer, seller sol.PublicKey) (*Escrow, error) {
	pda, _, err := c.GetEscrowPDA(buyer, seller)
	if err != nil {
		return nil, err
	}

	return c.FetchEscrow(ctx, pda)
}

// SendSOL transfers lamports from the oracle (treasury) wallet to a recipient
// using a System Program transfer instruction.
func (c *OracleClient) SendSOL(ctx context.Context, recipient sol.PublicKey, lamports uint64) (string, error) {
	// System Program Transfer: discriminator=2 (u32 LE) + amount (u64 LE)
	data := make([]byte, 12)
	data[0] = 2 // SystemInstruction::Transfer
	for i := 0; i < 8; i++ {
		data[4+i] = byte(lamports >> (8 * i))
	}

	instruction := &GenericInstruction{
		programID: sol.SystemProgramID,
		accounts: []*sol.AccountMeta{
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: true},
			{PublicKey: recipient, IsSigner: false, IsWritable: true},
		},
		data: data,
	}

	return c.sendInstruction(ctx, instruction)
}

// GenericInstruction is a generic Solana instruction builder
type GenericInstruction struct {
	programID sol.PublicKey
	accounts  []*sol.AccountMeta
	data      []byte
}

func (i *GenericInstruction) ProgramID() sol.PublicKey {
	return i.programID
}

func (i *GenericInstruction) Accounts() []*sol.AccountMeta {
	return i.accounts
}

func (i *GenericInstruction) Data() ([]byte, error) {
	return i.data, nil
}
