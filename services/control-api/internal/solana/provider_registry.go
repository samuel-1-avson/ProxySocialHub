// Package solana - on-chain provider registry transactions.
//
// Providers are indexed on-chain inside ProviderRegistry PDAs keyed by their
// Solana wallet pubkey.  The oracle (server wallet) submits these transactions
// so providers do not need to hold SOL for rent; the oracle pays.
//
// PDA seeds: ["provider-registry", provider_pubkey]
package solana

import (
	"context"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
)

// provider registry instruction discriminators
var (
	discRegisterProvider   = anchorDiscriminator("register_provider")
	discProviderHeartbeat  = anchorDiscriminator("provider_heartbeat")
	discDeregisterProvider = anchorDiscriminator("deregister_provider")
)

// RegisterProviderParams holds the data needed to register a provider on-chain.
type RegisterProviderParams struct {
	// Provider is the provider's Solana wallet pubkey (hotkey).
	Provider sol.PublicKey
	// Endpoint is the provider's HTTP/SOCKS endpoint, max 128 chars.
	Endpoint string
	// Location is a country/region code, max 32 chars.
	Location string
}

// ProviderHeartbeatParams holds the metrics to update in the on-chain registry.
type ProviderHeartbeatParams struct {
	// Provider is the provider's Solana wallet pubkey.
	Provider sol.PublicKey
	// QualityScore is 0-100; 100 = perfect.
	QualityScore uint8
	// BandwidthServedDelta is new bytes served since the last heartbeat.
	BandwidthServedDelta uint64
	// SuccessfulSessionsDelta is new successful session count.
	SuccessfulSessionsDelta uint32
	// FailedSessionsDelta is new failed session count.
	FailedSessionsDelta uint32
}

// GetProviderRegistryPDA derives the ProviderRegistry PDA for a given provider wallet.
func (c *OracleClient) GetProviderRegistryPDA(provider sol.PublicKey) (sol.PublicKey, uint8, error) {
	return sol.FindProgramAddress(
		[][]byte{[]byte("provider-registry"), provider.Bytes()},
		c.programID,
	)
}

// RegisterProviderOnChain creates a ProviderRegistry account on-chain for the given provider.
// If the PDA already exists, the call is a no-op (Anchor init returns an error which we swallow).
// The oracle pays for rent; providers do not need SOL.
func (c *OracleClient) RegisterProviderOnChain(ctx context.Context, params RegisterProviderParams) (string, error) {
	if len(params.Endpoint) > 128 {
		params.Endpoint = params.Endpoint[:128]
	}
	if len(params.Location) > 32 {
		params.Location = params.Location[:32]
	}

	registryPDA, _, err := c.GetProviderRegistryPDA(params.Provider)
	if err != nil {
		return "", fmt.Errorf("GetProviderRegistryPDA: %w", err)
	}

	statePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", fmt.Errorf("GetProgramStatePDA: %w", err)
	}

	// Instruction data (Borsh):
	// [8]  discriminator
	// [32] provider pubkey
	// [4]  endpoint length (u32 LE)
	// [N]  endpoint bytes
	// [4]  location length (u32 LE)
	// [M]  location bytes
	ep := []byte(params.Endpoint)
	loc := []byte(params.Location)

	data := make([]byte, 8+32+4+len(ep)+4+len(loc))
	copy(data[0:8], discRegisterProvider[:])
	copy(data[8:40], params.Provider.Bytes())
	putU32LE(data[40:44], uint32(len(ep)))
	copy(data[44:44+len(ep)], ep)
	off := 44 + len(ep)
	putU32LE(data[off:off+4], uint32(len(loc)))
	copy(data[off+4:], loc)

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: registryPDA, IsSigner: false, IsWritable: true},                // provider_registry
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: true},     // oracle (payer)
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},                  // program_state
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},       // system_program
		},
		data: data,
	}

	return c.sendInstruction(ctx, instruction)
}

// ProviderHeartbeatOnChain updates the on-chain ProviderRegistry with fresh metrics.
func (c *OracleClient) ProviderHeartbeatOnChain(ctx context.Context, params ProviderHeartbeatParams) (string, error) {
	registryPDA, _, err := c.GetProviderRegistryPDA(params.Provider)
	if err != nil {
		return "", fmt.Errorf("GetProviderRegistryPDA: %w", err)
	}

	statePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", fmt.Errorf("GetProgramStatePDA: %w", err)
	}

	// Instruction data (Borsh):
	// [8]  discriminator
	// [32] provider pubkey
	// [1]  quality_score (u8)
	// [8]  bandwidth_served_delta (u64 LE)
	// [4]  successful_sessions_delta (u32 LE)
	// [4]  failed_sessions_delta (u32 LE)
	data := make([]byte, 8+32+1+8+4+4)
	copy(data[0:8], discProviderHeartbeat[:])
	copy(data[8:40], params.Provider.Bytes())
	data[40] = params.QualityScore
	putU64LE(data[41:49], params.BandwidthServedDelta)
	putU32LE(data[49:53], params.SuccessfulSessionsDelta)
	putU32LE(data[53:57], params.FailedSessionsDelta)

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: registryPDA, IsSigner: false, IsWritable: true},            // provider_registry
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: false}, // oracle (admin)
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},               // program_state
		},
		data: data,
	}

	return c.sendInstruction(ctx, instruction)
}

// DeregisterProviderOnChain marks a provider as inactive in the on-chain registry.
func (c *OracleClient) DeregisterProviderOnChain(ctx context.Context, provider sol.PublicKey) (string, error) {
	registryPDA, _, err := c.GetProviderRegistryPDA(provider)
	if err != nil {
		return "", fmt.Errorf("GetProviderRegistryPDA: %w", err)
	}

	statePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", fmt.Errorf("GetProgramStatePDA: %w", err)
	}

	// Instruction data (Borsh):
	// [8]  discriminator
	// [32] provider pubkey
	data := make([]byte, 8+32)
	copy(data[0:8], discDeregisterProvider[:])
	copy(data[8:40], provider.Bytes())

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: registryPDA, IsSigner: false, IsWritable: true},            // provider_registry
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: false}, // oracle (admin)
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},               // program_state
		},
		data: data,
	}

	return c.sendInstruction(ctx, instruction)
}

// putU32LE writes a uint32 into buf in little-endian order.
func putU32LE(buf []byte, v uint32) {
	buf[0] = byte(v)
	buf[1] = byte(v >> 8)
	buf[2] = byte(v >> 16)
	buf[3] = byte(v >> 24)
}

// putU64LE writes a uint64 into buf in little-endian order.
func putU64LE(buf []byte, v uint64) {
	for i := 0; i < 8; i++ {
		buf[i] = byte(v >> (8 * i))
	}
}
