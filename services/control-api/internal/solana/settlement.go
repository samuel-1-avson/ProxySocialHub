// Package solana - settlement transaction builder
package solana

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"sync"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
	"github.com/proxyhubb/control-api/internal/logging"
)

// anchorDiscriminator computes the 8-byte Anchor instruction discriminator for a
// global namespace instruction: sha256("global:<name>")[0:8].
// P2-04: Single source of truth — replaces hardcoded byte literals throughout
// this file so the derivation algorithm is visible and auditable.
func anchorDiscriminator(name string) [8]byte {
	h := sha256.Sum256([]byte("global:" + name))
	var disc [8]byte
	copy(disc[:], h[:8])
	return disc
}

// Instruction discriminators — computed at package init, never hardcoded.
// Names match the Anchor IDL instruction identifiers exactly.
var (
	discSettleEscrow     = anchorDiscriminator("settle_escrow")
	discEmergencyRefund  = anchorDiscriminator("emergency_refund")
	discSlashStake       = anchorDiscriminator("slash_stake")
	discSubmitUsageProof = anchorDiscriminator("submit_usage_proof")
)

// SettlementTelemetry is a runtime snapshot of settlement activity by source.
// It helps prove which code path initiated each settlement operation.
type SettlementTelemetry struct {
	Source     string    `json:"source"`
	Attempts   uint64    `json:"attempts"`
	Successes  uint64    `json:"successes"`
	Failures   uint64    `json:"failures"`
	LastTxHash string    `json:"last_tx_hash,omitempty"`
	LastError  string    `json:"last_error,omitempty"`
	LastSeenAt time.Time `json:"last_seen_at"`
}

var settlementTelemetryStore = struct {
	mu   sync.RWMutex
	data map[string]*SettlementTelemetry
}{
	data: make(map[string]*SettlementTelemetry),
}

func recordSettlementTelemetry(source string, txHash string, err error) {
	settlementTelemetryStore.mu.Lock()
	defer settlementTelemetryStore.mu.Unlock()

	entry, ok := settlementTelemetryStore.data[source]
	if !ok {
		entry = &SettlementTelemetry{Source: source}
		settlementTelemetryStore.data[source] = entry
	}

	entry.Attempts++
	entry.LastSeenAt = time.Now().UTC()
	if err != nil {
		entry.Failures++
		entry.LastError = err.Error()
		return
	}

	entry.Successes++
	entry.LastError = ""
	entry.LastTxHash = txHash
}

// GetSettlementTelemetrySnapshot returns a point-in-time copy of settlement telemetry.
func GetSettlementTelemetrySnapshot() []SettlementTelemetry {
	settlementTelemetryStore.mu.RLock()
	defer settlementTelemetryStore.mu.RUnlock()

	out := make([]SettlementTelemetry, 0, len(settlementTelemetryStore.data))
	for _, v := range settlementTelemetryStore.data {
		out = append(out, *v)
	}
	return out
}

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

// SettleEscrow creates and sends a settle_escrow transaction.
// This transfers funds proportionally: used portion to seller, remainder to buyer.
// source must identify the runtime call path (for example: api.escrow.release).
func (c *OracleClient) SettleEscrow(ctx context.Context, source string, params SettleEscrowParams) (string, error) {
	source = strings.TrimSpace(source)
	if source == "" {
		err := fmt.Errorf("settlement source label is required")
		recordSettlementTelemetry("missing_source", "", err)
		return "", err
	}

	logging.Info().
		Str("source", source).
		Str("escrow_pda", params.EscrowPDA.String()).
		Uint64("bandwidth_used_gb", params.BandwidthUsedGB).
		Msg("SettleEscrow attempt")

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
		recordSettlementTelemetry(source, "", err)
		return "", fmt.Errorf("failed to get recent blockhash: %w", err)
	}

	// Build transaction
	tx, err := sol.NewTransaction(
		[]sol.Instruction{instruction},
		recentBlockhash.Value.Blockhash,
		sol.TransactionPayer(c.GetOraclePublicKey()),
	)
	if err != nil {
		recordSettlementTelemetry(source, "", err)
		return "", fmt.Errorf("failed to build transaction: %w", err)
	}

	// Sign transaction with oracle key
	err = c.SignTransaction(ctx, tx)
	if err != nil {
		recordSettlementTelemetry(source, "", err)
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
		recordSettlementTelemetry(source, "", err)
		return "", fmt.Errorf("failed to send transaction: %w", err)
	}

	recordSettlementTelemetry(source, sig.String(), nil)
	logging.Info().
		Str("source", source).
		Str("tx_hash", sig.String()).
		Msg("SettleEscrow success")

	return sig.String(), nil
}

// BatchSettleEscrows builds and sends a transaction with multiple settle_escrow instructions.
// source must identify the runtime call path.
func (c *OracleClient) BatchSettleEscrows(ctx context.Context, source string, batch []SettleEscrowParams) (string, error) {
	source = strings.TrimSpace(source)
	if source == "" {
		err := fmt.Errorf("batch settlement source label is required")
		recordSettlementTelemetry("missing_source", "", err)
		return "", err
	}

	if len(batch) == 0 {
		err := fmt.Errorf("empty batch")
		recordSettlementTelemetry(source, "", err)
		return "", err
	}

	logging.Info().
		Str("source", source).
		Int("batch_size", len(batch)).
		Msg("BatchSettleEscrows attempt")

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
		recordSettlementTelemetry(source, "", err)
		return "", fmt.Errorf("failed to get recent blockhash: %w", err)
	}

	// Build transaction with all instructions
	tx, err := sol.NewTransaction(
		instructions,
		recentBlockhash.Value.Blockhash,
		sol.TransactionPayer(c.GetOraclePublicKey()),
	)
	if err != nil {
		recordSettlementTelemetry(source, "", err)
		return "", fmt.Errorf("failed to build batch transaction: %w", err)
	}

	// Sign transaction
	err = c.SignTransaction(ctx, tx)
	if err != nil {
		recordSettlementTelemetry(source, "", err)
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
		recordSettlementTelemetry(source, "", err)
		return "", fmt.Errorf("failed to send batch transaction: %w", err)
	}

	recordSettlementTelemetry(source, sig.String(), nil)
	logging.Info().
		Str("source", source).
		Str("tx_hash", sig.String()).
		Int("batch_size", len(batch)).
		Msg("BatchSettleEscrows success")

	return sig.String(), nil
}

// buildSettleInstruction creates the settle_escrow instruction
func (c *OracleClient) buildSettleInstruction(params SettleEscrowParams) sol.Instruction {
	// Encode bandwidth_used_gb as little-endian u64
	data := make([]byte, 8+8) // discriminator + u64
	copy(data[0:8], discSettleEscrow[:])
	for i := 0; i < 8; i++ {
		data[8+i] = byte(params.BandwidthUsedGB >> (8 * i))
	}

	return &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: c.GetOraclePublicKey(), IsSigner: true, IsWritable: false}, // oracle
			{PublicKey: params.EscrowPDA, IsSigner: false, IsWritable: true},        // escrow
			{PublicKey: params.Buyer, IsSigner: false, IsWritable: true},            // buyer
			{PublicKey: params.Seller, IsSigner: false, IsWritable: true},           // seller
		},
		data: data,
	}
}

// EmergencyRefund executes an emergency refund after timeout
func (c *OracleClient) EmergencyRefund(ctx context.Context, params RefundEscrowParams) (string, error) {
	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: params.Buyer, IsSigner: true, IsWritable: true},
			{PublicKey: params.EscrowPDA, IsSigner: false, IsWritable: true},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		},
		data: discEmergencyRefund[:],
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
	copy(data[0:8], discSlashStake[:])
	for i := 0; i < 8; i++ {
		data[8+i] = byte(params.Amount >> (8 * i))
	}

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: c.GetOraclePublicKey(), IsSigner: true, IsWritable: false}, // admin
			{PublicKey: stakePDA, IsSigner: false, IsWritable: true},
			{PublicKey: c.GetOraclePublicKey(), IsSigner: false, IsWritable: true}, // oracle_wallet (payout)
			{PublicKey: adminConfigPDA, IsSigner: false, IsWritable: false},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		},
		data: data,
	}

	return c.sendInstruction(ctx, instruction)
}

// SubmitUsageProof executes a submit_usage_proof instruction
func (c *OracleClient) SubmitUsageProof(ctx context.Context, params SubmitUsageProofParams) (string, error) {
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
	copy(data[0:8], discSubmitUsageProof[:])
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
			{PublicKey: c.GetOraclePublicKey(), IsSigner: true, IsWritable: true}, // submitter
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

	tx, err := sol.NewTransaction([]sol.Instruction{instruction}, recentBlockhash.Value.Blockhash, sol.TransactionPayer(c.GetOraclePublicKey()))
	if err != nil {
		return "", err
	}

	err = c.SignTransaction(ctx, tx)
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

// SendSOLTestHook, when set, replaces SendSOL (used by api package tests).
var SendSOLTestHook func(ctx context.Context, c *OracleClient, recipient sol.PublicKey, lamports uint64) (string, error)

// SendSOL transfers lamports from the oracle (treasury) wallet to a recipient
// using a System Program transfer instruction.
func (c *OracleClient) SendSOL(ctx context.Context, recipient sol.PublicKey, lamports uint64) (string, error) {
	if SendSOLTestHook != nil {
		return SendSOLTestHook(ctx, c, recipient, lamports)
	}
	// Velocity guard: enforce per-transfer cap and hourly outflow limit.
	amountSOL := LamportsToSOL(lamports)
	// P0-07: VelocityGuard is mandatory. Block the transfer if it was never attached
	// rather than proceeding unchecked (previous behaviour allowed unlimited outflow).
	if c.velocity == nil {
		return "", fmt.Errorf("SendSOL blocked: VelocityGuard not initialised — call SetVelocityGuard before sending SOL")
	}
	if err := c.velocity.Check(ctx, amountSOL); err != nil {
		return "", fmt.Errorf("SendSOL blocked by velocity guard: %w", err)
	}

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

// BatchTransferSOL transfers SOL to multiple recipients in a single transaction.
// This saves significantly on transaction fees compared to individual transfers.
// Returns the transaction hash and any error that occurred.
func (c *OracleClient) BatchTransferSOL(ctx context.Context, transfers []TransferRequest) (string, error) {
	if len(transfers) == 0 {
		return "", fmt.Errorf("no transfers provided")
	}
	if len(transfers) > 20 {
		return "", fmt.Errorf("batch size exceeds maximum of 20 transfers")
	}

	// Velocity guard: sum the batch total and check against limits.
	var totalSOL float64
	for _, t := range transfers {
		totalSOL += LamportsToSOL(t.Lamports)
	}
	// P0-07: same mandatory guard as SendSOL.
	if c.velocity == nil {
		return "", fmt.Errorf("BatchTransferSOL blocked: VelocityGuard not initialised — call SetVelocityGuard before sending SOL")
	}
	if err := c.velocity.Check(ctx, totalSOL); err != nil {
		return "", fmt.Errorf("BatchTransferSOL blocked by velocity guard: %w", err)
	}

	// Build instructions for all transfers
	instructions := make([]sol.Instruction, len(transfers))
	for i, t := range transfers {
		// System Program Transfer: discriminator=2 (u32 LE) + amount (u64 LE)
		data := make([]byte, 12)
		data[0] = 2 // SystemInstruction::Transfer
		for j := 0; j < 8; j++ {
			data[4+j] = byte(t.Lamports >> (8 * j))
		}

		instructions[i] = &GenericInstruction{
			programID: sol.SystemProgramID,
			accounts: []*sol.AccountMeta{
				{PublicKey: c.GetOraclePublicKey(), IsSigner: true, IsWritable: true},
				{PublicKey: t.Recipient, IsSigner: false, IsWritable: true},
			},
			data: data,
		}
	}

	// Build and sign transaction with all instructions
	recentBlockhash, err := c.rpc().GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
	if err != nil {
		return "", fmt.Errorf("failed to get recent blockhash: %w", err)
	}

	tx, err := sol.NewTransaction(
		instructions,
		recentBlockhash.Value.Blockhash,
		sol.TransactionPayer(c.GetOraclePublicKey()),
	)
	if err != nil {
		return "", fmt.Errorf("failed to build transaction: %w", err)
	}

	// Sign transaction
	err = c.SignTransaction(ctx, tx)
	if err != nil {
		return "", fmt.Errorf("failed to sign transaction: %w", err)
	}

	// Send transaction
	sig, err := c.rpc().SendTransactionWithOpts(ctx, tx,
		rpc.TransactionOpts{
			Encoding:            "base64",
			SkipPreflight:       false,
			PreflightCommitment: rpc.CommitmentConfirmed,
		},
	)
	if err != nil {
		return "", fmt.Errorf("failed to send transaction: %w", err)
	}

	return sig.String(), nil
}

// TransferRequest represents a single transfer in a batch
type TransferRequest struct {
	Recipient sol.PublicKey
	Lamports  uint64
}
