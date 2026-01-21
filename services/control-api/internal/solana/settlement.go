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

// SettleEscrow creates and sends a settle_escrow transaction
// This transfers funds proportionally: used portion to seller, remainder to buyer
func (c *OracleClient) SettleEscrow(ctx context.Context, params SettleEscrowParams) (string, error) {
	// Build the settle_escrow instruction
	instruction := c.buildSettleInstruction(params)

	// Get recent blockhash
	recentBlockhash, err := c.rpcClient.GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
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
	sig, err := c.rpcClient.SendTransaction(ctx, tx)
	if err != nil {
		return "", fmt.Errorf("failed to send transaction: %w", err)
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
