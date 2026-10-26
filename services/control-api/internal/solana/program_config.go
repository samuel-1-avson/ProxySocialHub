// Package solana — on-chain ProgramConfig (Section K.12).
//
// Security-critical parameters (KYC min balance, platform fee, spending limits)
// are stored in the ProgramConfig PDA so they cannot be changed by a single
// compromised admin DB row.  On chain, update_program_config binds its
// signer to program_state.admin (P1-SC-2 hardening). This client is
// read-only: it has no update sender, so control-api cannot change it.
//
// PDA seeds: ["program_config"]
//
// Account order for update_program_config:
//   0  oracle          — Signer (must equal program_state.admin)
//   1  program_config  — init_if_needed PDA ["program_config"]
//   2  system_program
//   3  multisig_oracle — read-only
//   4  program_state   — pause guard + admin binding
package solana

import (
	"context"
	"encoding/binary"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

var discUpdateProgramConfig = anchorDiscriminator("update_program_config")

// OnChainProgramConfig mirrors the ProgramConfig account in lib.rs.
type OnChainProgramConfig struct {
	KYCMinSOLLamports      uint64 `json:"kyc_min_sol_lamports"`
	PlatformFeeBPS         uint16 `json:"platform_fee_bps"`
	MaxDailySpendLamports  uint64 `json:"max_daily_spend_lamports"`
	MaxSessionBWBytes      uint64 `json:"max_session_bw_bytes"`
	UnstakeCooldownSeconds int64  `json:"unstake_cooldown_seconds"`
	UpdatedAt              int64  `json:"updated_at"`
	Address                string `json:"address"`
}

// ProgramConfigPDA returns the ProgramConfig PDA.
func (c *OracleClient) ProgramConfigPDA() (sol.PublicKey, uint8, error) {
	return sol.FindProgramAddress([][]byte{[]byte("program_config")}, c.programID)
}

// decodeProgramConfig decodes raw ProgramConfig account data. Layout after
// the 8-byte discriminator (Anchor/Borsh, no padding), 51 bytes total:
//
//	[0:8]   kyc_min_sol_lamports     u64 LE
//	[8:10]  platform_fee_bps         u16 LE
//	[10:18] max_daily_spend_lamports u64 LE
//	[18:26] max_session_bw_bytes     u64 LE
//	[26:34] unstake_cooldown_seconds i64 LE
//	[34:42] updated_at               i64 LE (unix timestamp)
//	[42]    bump                     u8
//
// Verified against the ProgramConfig type in the committed IDL during
// P2-ABI-1. The previous decoder stopped at byte 34 and reported the
// cooldown value as updated_at.
func decodeProgramConfig(raw []byte, pda sol.PublicKey) (*OnChainProgramConfig, error) {
	if len(raw) < 51 {
		return nil, fmt.Errorf("account data too short: %d bytes (need 51)", len(raw))
	}
	body := raw[8:]
	cfg := &OnChainProgramConfig{Address: pda.String()}
	cfg.KYCMinSOLLamports = binary.LittleEndian.Uint64(body[0:8])
	cfg.PlatformFeeBPS = binary.LittleEndian.Uint16(body[8:10])
	cfg.MaxDailySpendLamports = binary.LittleEndian.Uint64(body[10:18])
	cfg.MaxSessionBWBytes = binary.LittleEndian.Uint64(body[18:26])
	cfg.UnstakeCooldownSeconds = int64(binary.LittleEndian.Uint64(body[26:34]))
	cfg.UpdatedAt = int64(binary.LittleEndian.Uint64(body[34:42]))
	return cfg, nil
}

// ReadProgramConfig reads the on-chain ProgramConfig. Returns (nil, nil) if
// the account doesn't exist yet (not initialized on this deployment).
func (c *OracleClient) ReadProgramConfig(ctx context.Context) (*OnChainProgramConfig, error) {
	pda, _, err := c.ProgramConfigPDA()
	if err != nil {
		return nil, fmt.Errorf("ProgramConfigPDA: %w", err)
	}

	var accountInfo *rpc.GetAccountInfoResult
	if err := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		accountInfo, e = client.GetAccountInfoWithOpts(ctx, pda, &rpc.GetAccountInfoOpts{
			Encoding: sol.EncodingBase64,
		})
		return e
	}); err != nil {
		return nil, fmt.Errorf("ReadProgramConfig: %w", err)
	}
	if accountInfo == nil || accountInfo.Value == nil {
		return nil, nil
	}

	cfg, err := decodeProgramConfig(accountInfo.Value.Data.GetBinary(), pda)
	if err != nil {
		return nil, fmt.Errorf("ReadProgramConfig: %w", err)
	}
	return cfg, nil
}
