// Package solana — deposit vault PDA helpers (Phase 1 decentralization).
package solana

import (
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"strings"

	sol "github.com/gagliardetto/solana-go"
)

var (
	discInitializeDepositVault = anchorDiscriminator("initialize_deposit_vault")
	discWithdrawFromVault      = anchorDiscriminator("withdraw_from_vault")
	discUpdateDepositVaultHot  = anchorDiscriminator("update_deposit_vault_hot")
)

// GetDepositVaultAddress returns the configured deposit vault pubkey from env.
// Empty string means vault path is not configured.
func GetDepositVaultAddress() string {
	return strings.TrimSpace(os.Getenv("SOLANA_DEPOSIT_VAULT_ADDRESS"))
}

// GetDepositVaultPubkey parses SOLANA_DEPOSIT_VAULT_ADDRESS or returns zero.
func GetDepositVaultPubkey() sol.PublicKey {
	addr := GetDepositVaultAddress()
	if addr == "" {
		return sol.PublicKey{}
	}
	pk, err := sol.PublicKeyFromBase58(addr)
	if err != nil {
		return sol.PublicKey{}
	}
	return pk
}

// GetDepositVaultPDA derives the canonical deposit vault PDA for this program.
func (c *OracleClient) GetDepositVaultPDA() (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{[]byte("deposit_vault")},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("GetDepositVaultPDA: %w", err)
	}
	return pda, bump, nil
}

// InitializeDepositVaultParams for initialize_deposit_vault.
type InitializeDepositVaultParams struct {
	HotTreasury        sol.PublicKey
	WithdrawAuthority  sol.PublicKey // typically oracle pubkey
}

// InitializeDepositVault creates the deposit_vault PDA (admin must equal program_state.admin).
// Uses the oracle keypair as the fee payer/signer — only works when oracle == program admin.
func (c *OracleClient) InitializeDepositVault(ctx context.Context, params InitializeDepositVaultParams) (string, sol.PublicKey, error) {
	if params.HotTreasury.IsZero() || params.WithdrawAuthority.IsZero() {
		return "", sol.PublicKey{}, fmt.Errorf("hot treasury and withdraw authority are required")
	}

	vaultPDA, _, err := c.GetDepositVaultPDA()
	if err != nil {
		return "", sol.PublicKey{}, err
	}
	programStatePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("InitializeDepositVault: program_state PDA: %w", err)
	}

	// Data: disc(8) + hot_treasury(32) + withdraw_authority(32)
	data := make([]byte, 8+32+32)
	copy(data[0:8], discInitializeDepositVault[:])
	copy(data[8:40], params.HotTreasury.Bytes())
	copy(data[40:72], params.WithdrawAuthority.Bytes())

	ix := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: vaultPDA, IsSigner: false, IsWritable: true},
			{PublicKey: programStatePDA, IsSigner: false, IsWritable: false},
			{PublicKey: c.GetOraclePublicKey(), IsSigner: true, IsWritable: true},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		},
		data: data,
	}

	txHash, err := c.sendInstruction(ctx, ix)
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("InitializeDepositVault: %w", err)
	}
	return txHash, vaultPDA, nil
}

// WithdrawFromVaultParams for withdraw_from_vault (vault → hot only).
type WithdrawFromVaultParams struct {
	AmountLamports uint64
	HotTreasury    sol.PublicKey // must match on-chain vault.hot_treasury
}

// WithdrawFromVault moves SOL from the deposit vault PDA to the bound hot treasury.
// Signed by the oracle (must be vault.withdraw_authority or admin).
func (c *OracleClient) WithdrawFromVault(ctx context.Context, params WithdrawFromVaultParams) (string, error) {
	if params.AmountLamports == 0 {
		return "", fmt.Errorf("withdraw amount must be > 0 lamports")
	}
	hot := params.HotTreasury
	if hot.IsZero() {
		envHot := strings.TrimSpace(os.Getenv("SOLANA_TREASURY_HOT_ADDRESS"))
		if envHot == "" {
			envHot = strings.TrimSpace(os.Getenv("SOLANA_TREASURY_ADDRESS"))
		}
		if envHot == "" {
			return "", fmt.Errorf("hot treasury address required for vault withdraw")
		}
		var err error
		hot, err = sol.PublicKeyFromBase58(envHot)
		if err != nil {
			return "", fmt.Errorf("invalid hot treasury: %w", err)
		}
	}

	vaultPDA, _, err := c.GetDepositVaultPDA()
	if err != nil {
		return "", err
	}
	if configured := GetDepositVaultPubkey(); !configured.IsZero() && !configured.Equals(vaultPDA) {
		return "", fmt.Errorf(
			"SOLANA_DEPOSIT_VAULT_ADDRESS %s does not match derived PDA %s",
			configured, vaultPDA,
		)
	}

	programStatePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", fmt.Errorf("WithdrawFromVault: program_state PDA: %w", err)
	}

	data := make([]byte, 8+8)
	copy(data[0:8], discWithdrawFromVault[:])
	binary.LittleEndian.PutUint64(data[8:16], params.AmountLamports)

	ix := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: vaultPDA, IsSigner: false, IsWritable: true},
			{PublicKey: hot, IsSigner: false, IsWritable: true},
			{PublicKey: programStatePDA, IsSigner: false, IsWritable: false},
			{PublicKey: c.GetOraclePublicKey(), IsSigner: true, IsWritable: false},
		},
		data: data,
	}

	txHash, err := c.sendInstruction(ctx, ix)
	if err != nil {
		return "", fmt.Errorf("WithdrawFromVault: %w", err)
	}
	return txHash, nil
}
