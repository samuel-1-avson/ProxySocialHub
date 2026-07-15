// Package solana — on-chain provider staking transactions.
//
// These methods submit canonical stake and unstake instructions so control-api
// no longer relies on DB-only staking state transitions.
package solana

import (
	"context"
	"encoding/binary"
	"fmt"
	"strings"

	sol "github.com/gagliardetto/solana-go"
)

var (
	discStakeProvider   = anchorDiscriminator("stake_provider")
	discUnstakeProvider = anchorDiscriminator("unstake_provider")
)

// StakeProviderParams contains arguments for stake_provider.
type StakeProviderParams struct {
	ProviderWallet sol.PublicKey
	AmountLamports uint64
}

// UnstakeProviderParams contains arguments for unstake_provider.
type UnstakeProviderParams struct {
	ProviderWallet sol.PublicKey
	AmountLamports uint64
}

// GetProviderStakePDA derives the canonical stake PDA for a provider wallet.
func (c *OracleClient) GetProviderStakePDA(providerWallet sol.PublicKey) (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{[]byte("stake"), providerWallet.Bytes()},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("GetProviderStakePDA: %w", err)
	}
	return pda, bump, nil
}

// StakeProvider submits a stake_provider instruction and returns tx hash + stake PDA.
func (c *OracleClient) StakeProvider(ctx context.Context, params StakeProviderParams) (string, sol.PublicKey, error) {
	if params.AmountLamports == 0 {
		return "", sol.PublicKey{}, fmt.Errorf("stake amount must be > 0 lamports")
	}

	if ok, determined, missing := SupportsInstructionsFromCachedIDL(ctx, c.programID.String(), "stake_provider"); determined && !ok {
		return "", sol.PublicKey{}, NewProgramUpgradeRequiredError(
			"staking_v2",
			"stake_provider",
			fmt.Errorf("instruction missing from cached on-chain IDL: %s", strings.Join(missing, ",")),
		)
	}

	stakePDA, _, err := c.GetProviderStakePDA(params.ProviderWallet)
	if err != nil {
		return "", sol.PublicKey{}, err
	}
	programStatePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("StakeProvider: program_state PDA: %w", err)
	}

	// Data: disc(8) + provider_wallet(32) + amount_lamports(8)
	data := make([]byte, 8+32+8)
	copy(data[0:8], discStakeProvider[:])
	copy(data[8:40], params.ProviderWallet.Bytes())
	binary.LittleEndian.PutUint64(data[40:48], params.AmountLamports)

	ix := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: c.GetOraclePublicKey(), IsSigner: true, IsWritable: true},
			{PublicKey: stakePDA, IsSigner: false, IsWritable: true},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
			{PublicKey: programStatePDA, IsSigner: false, IsWritable: false},
		},
		data: data,
	}

	txHash, err := c.sendInstruction(ctx, ix)
	if err != nil {
		if IsInstructionUnsupportedError(err) {
			return "", sol.PublicKey{}, NewProgramUpgradeRequiredError("staking_v2", "stake_provider", err)
		}
		return "", sol.PublicKey{}, fmt.Errorf("StakeProvider: %w", err)
	}
	return txHash, stakePDA, nil
}

// UnstakeProvider submits an unstake_provider instruction and returns tx hash + stake PDA.
func (c *OracleClient) UnstakeProvider(ctx context.Context, params UnstakeProviderParams) (string, sol.PublicKey, error) {
	if params.AmountLamports == 0 {
		return "", sol.PublicKey{}, fmt.Errorf("unstake amount must be > 0 lamports")
	}

	if ok, determined, missing := SupportsInstructionsFromCachedIDL(ctx, c.programID.String(), "unstake_provider"); determined && !ok {
		return "", sol.PublicKey{}, NewProgramUpgradeRequiredError(
			"staking_v2",
			"unstake_provider",
			fmt.Errorf("instruction missing from cached on-chain IDL: %s", strings.Join(missing, ",")),
		)
	}

	stakePDA, _, err := c.GetProviderStakePDA(params.ProviderWallet)
	if err != nil {
		return "", sol.PublicKey{}, err
	}
	programStatePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("UnstakeProvider: program_state PDA: %w", err)
	}
	programConfigPDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_config")}, c.programID)
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("UnstakeProvider: program_config PDA: %w", err)
	}

	// Data: disc(8) + provider_wallet(32) + amount_lamports(8)
	data := make([]byte, 8+32+8)
	copy(data[0:8], discUnstakeProvider[:])
	copy(data[8:40], params.ProviderWallet.Bytes())
	binary.LittleEndian.PutUint64(data[40:48], params.AmountLamports)

	ix := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: c.GetOraclePublicKey(), IsSigner: true, IsWritable: true},
			{PublicKey: stakePDA, IsSigner: false, IsWritable: true},
			{PublicKey: programStatePDA, IsSigner: false, IsWritable: false},
			{PublicKey: programConfigPDA, IsSigner: false, IsWritable: false},
		},
		data: data,
	}

	txHash, err := c.sendInstruction(ctx, ix)
	if err != nil {
		if IsInstructionUnsupportedError(err) {
			return "", sol.PublicKey{}, NewProgramUpgradeRequiredError("staking_v2", "unstake_provider", err)
		}
		return "", sol.PublicKey{}, fmt.Errorf("UnstakeProvider: %w", err)
	}
	return txHash, stakePDA, nil
}
