// Package solana — on-chain program config client (CONFIG-001/002).
//
// Security-critical parameters (KYC min balance, platform fee, spending limits)
// are stored in the ProgramConfig PDA so they cannot be changed by a single
// compromised admin DB row.  Updates require the multisig oracle.
//
// PDA seeds: ["program_config"]
//
// Account order for update_program_config:
//   0  oracle          — Signer (must be in multisig_oracle.signers)
//   1  program_config  — init_if_needed PDA ["program_config"]
//   2  system_program
//   3  multisig_oracle — read-only (threshold check)
//   4  program_state   — pause guard
package solana

import (
	"context"
	"encoding/binary"
	"fmt"
	"sync"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

var discUpdateProgramConfig = anchorDiscriminator("update_program_config")

// ProgramConfigData holds the decoded on-chain ProgramConfig values.
type ProgramConfigData struct {
	KYCMinSOLLamports      uint64
	PlatformFeeBPS         uint16 // basis points; 1000 = 10%
	MaxDailySpendLamports  uint64
	MaxSessionBWBytes      uint64
	UpdatedAt              int64
}

// programConfigCache provides a short-lived in-process cache to avoid
// per-request RPC calls for the program config.
var programConfigCache struct {
	mu        sync.RWMutex
	data      *ProgramConfigData
	fetchedAt time.Time
	ttl       time.Duration
}

func init() {
	programConfigCache.ttl = 60 * time.Second
}

// UpdateProgramConfigParams holds parameters for updating the on-chain config.
type UpdateProgramConfigParams struct {
	KYCMinSOLLamports     uint64
	PlatformFeeBPS        uint16
	MaxDailySpendLamports uint64
	MaxSessionBWBytes     uint64
}

// GetProgramConfigPDA derives the program config PDA.
func (c *OracleClient) GetProgramConfigPDA() (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{[]byte("program_config")},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("GetProgramConfigPDA: %w", err)
	}
	return pda, bump, nil
}

// ReadProgramConfig fetches the on-chain ProgramConfig, using an in-process
// cache with 60-second TTL to avoid per-request RPC latency.
//
// Layout after 8-byte discriminator:
//   [0:8]   kyc_min_sol_lamports (u64 LE)
//   [8:10]  platform_fee_bps     (u16 LE)
//   [10:18] max_daily_spend_lamports (u64 LE)
//   [18:26] max_session_bw_bytes (u64 LE)
//   [26:34] updated_at           (i64 LE)
//   [34]    bump                 (u8)
func (c *OracleClient) ReadProgramConfig(ctx context.Context) (*ProgramConfigData, error) {
	// Check cache.
	programConfigCache.mu.RLock()
	if programConfigCache.data != nil && time.Since(programConfigCache.fetchedAt) < programConfigCache.ttl {
		cached := programConfigCache.data
		programConfigCache.mu.RUnlock()
		return cached, nil
	}
	programConfigCache.mu.RUnlock()

	configPDA, _, err := c.GetProgramConfigPDA()
	if err != nil {
		return nil, err
	}

	var accountInfo *rpc.GetAccountInfoResult
	if fetchErr := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		accountInfo, e = client.GetAccountInfo(ctx, configPDA)
		return e
	}); fetchErr != nil {
		return nil, fmt.Errorf("ReadProgramConfig: RPC error: %w", fetchErr)
	}
	if accountInfo == nil || accountInfo.Value == nil {
		return nil, fmt.Errorf("ReadProgramConfig: program_config PDA not initialized")
	}

	raw := accountInfo.Value.Data.GetBinary()
	if len(raw) < 35 {
		return nil, fmt.Errorf("ReadProgramConfig: data too short (%d bytes)", len(raw))
	}

	body := raw[8:]
	cfg := &ProgramConfigData{
		KYCMinSOLLamports:     binary.LittleEndian.Uint64(body[0:8]),
		PlatformFeeBPS:        binary.LittleEndian.Uint16(body[8:10]),
		MaxDailySpendLamports: binary.LittleEndian.Uint64(body[10:18]),
		MaxSessionBWBytes:     binary.LittleEndian.Uint64(body[18:26]),
		UpdatedAt:             int64(binary.LittleEndian.Uint64(body[26:34])),
	}

	// Update cache.
	programConfigCache.mu.Lock()
	programConfigCache.data = cfg
	programConfigCache.fetchedAt = time.Now()
	programConfigCache.mu.Unlock()

	return cfg, nil
}

// InvalidateProgramConfigCache clears the in-process cache, forcing the next
// ReadProgramConfig call to fetch fresh data from chain.
func InvalidateProgramConfigCache() {
	programConfigCache.mu.Lock()
	programConfigCache.data = nil
	programConfigCache.mu.Unlock()
}

// LamportsToSOL converts lamports to SOL (already defined in client.go,
// so we just alias the constant here for clarity in config comparisons).
const lamportsPerSOL = 1_000_000_000
