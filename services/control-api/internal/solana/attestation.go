// Package solana — KYC attestation on-chain read/write.
//
// The oracle writes a KYCAttestation PDA keyed by ["kyc_attestation", wallet]
// whenever a user's trust tier or KYC status changes.  This makes trust
// elevation verifiable without trusting the server database.
//
// Trust tiers: 0=new, 1=verified, 2=premium
// KYC status:  0=none, 1=pending, 2=approved, 3=rejected
//
// Account order for write_kyc_attestation (must match WriteKYCAttestation
// context struct in lib.rs):
//   0  oracle          — Signer, writable (pays rent on first init)
//   1  attestation     — init_if_needed PDA ["kyc_attestation", wallet]
//   2  system_program
//   3  program_state   — pause guard
package solana

import (
	"context"
	"encoding/binary"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

// Instruction discriminator — computed once at package init.
var discWriteKYCAttestation = anchorDiscriminator("write_kyc_attestation")

// KYC trust tier constants (mirror the Anchor program u8 values).
const (
	KYCTierNew      uint8 = 0
	KYCTierVerified uint8 = 1
	KYCTierPremium  uint8 = 2
)

// KYC status constants (mirror the Anchor program u8 values).
const (
	KYCStatusNoneOnChain     uint8 = 0
	KYCStatusPendingOnChain  uint8 = 1
	KYCStatusApprovedOnChain uint8 = 2
	KYCStatusRejectedOnChain uint8 = 3
)

// WriteKYCAttestationParams holds the parameters for writing a KYC attestation.
type WriteKYCAttestationParams struct {
	// Wallet is the user's Solana public key being attested.
	Wallet sol.PublicKey
	// TrustTier: 0=new, 1=verified, 2=premium.
	TrustTier uint8
	// KYCStatus: 0=none, 1=pending, 2=approved, 3=rejected.
	KYCStatus uint8
}

// KYCAttestationData is returned by ReadKYCAttestation.
type KYCAttestationData struct {
	Wallet      sol.PublicKey
	Oracle      sol.PublicKey
	TrustTier   uint8
	KYCStatus   uint8
	AttestedAt  int64
}

// GetKYCAttestationPDA derives the KYC attestation PDA for a given wallet.
func (c *OracleClient) GetKYCAttestationPDA(wallet sol.PublicKey) (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{[]byte("kyc_attestation"), wallet.Bytes()},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("GetKYCAttestationPDA: %w", err)
	}
	return pda, bump, nil
}

// WriteKYCAttestation sends a write_kyc_attestation instruction to Solana.
// The oracle signs and pays rent.  The PDA is created on first call and
// updated in-place on subsequent calls (init_if_needed).
//
// Returns the transaction signature on success.
func (c *OracleClient) WriteKYCAttestation(ctx context.Context, params WriteKYCAttestationParams) (string, error) {
	attestPDA, _, err := c.GetKYCAttestationPDA(params.Wallet)
	if err != nil {
		return "", err
	}

	statePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", fmt.Errorf("WriteKYCAttestation: program_state PDA: %w", err)
	}

	// Encode instruction data:
	//   [0:8]   discriminator (8 bytes)
	//   [8:40]  wallet pubkey (32 bytes)
	//   [40]    trust_tier (u8)
	//   [41]    kyc_status (u8)
	data := make([]byte, 8+32+1+1)
	copy(data[0:8], discWriteKYCAttestation[:])
	copy(data[8:40], params.Wallet.Bytes())
	data[40] = params.TrustTier
	data[41] = params.KYCStatus

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: c.GetOraclePublicKey(), IsSigner: true, IsWritable: true}, // oracle (admin / KMS)
			{PublicKey: attestPDA, IsSigner: false, IsWritable: true},               // attestation PDA
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},    // system_program
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},               // program_state
		},
		data: data,
	}

	return c.sendInstruction(ctx, instruction)
}

// ReadKYCAttestation fetches and decodes the on-chain KYCAttestation account
// for a given wallet.  Returns ErrNotFound (wrapped) if no attestation exists.
//
// On-chain layout (after 8-byte discriminator):
//   [0:32]  wallet  (Pubkey)
//   [32:64] oracle  (Pubkey)
//   [64]    trust_tier (u8)
//   [65]    kyc_status (u8)
//   [66:74] attested_at (i64 LE)
//   [74]    bump (u8)
func (c *OracleClient) ReadKYCAttestation(ctx context.Context, wallet sol.PublicKey) (*KYCAttestationData, error) {
	attestPDA, _, err := c.GetKYCAttestationPDA(wallet)
	if err != nil {
		return nil, err
	}

	var accountInfo *rpc.GetAccountInfoResult
	fetchErr := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		accountInfo, e = client.GetAccountInfo(ctx, attestPDA)
		return e
	})
	if fetchErr != nil {
		return nil, fmt.Errorf("ReadKYCAttestation: RPC error: %w", fetchErr)
	}
	if accountInfo == nil || accountInfo.Value == nil {
		return nil, fmt.Errorf("ReadKYCAttestation: no attestation found for wallet %s", wallet)
	}

	raw := accountInfo.Value.Data.GetBinary()
	// Minimum size: 8 (disc) + 32 + 32 + 1 + 1 + 8 + 1 = 83 bytes
	if len(raw) < 83 {
		return nil, fmt.Errorf("ReadKYCAttestation: account data too short (%d bytes)", len(raw))
	}

	body := raw[8:] // skip discriminator
	att := &KYCAttestationData{}
	copy(att.Wallet[:], body[0:32])
	copy(att.Oracle[:], body[32:64])
	att.TrustTier = body[64]
	att.KYCStatus = body[65]
	att.AttestedAt = int64(binary.LittleEndian.Uint64(body[66:74]))

	return att, nil
}

// ZeroPublicKey returns the zero-value Solana public key (all bytes zero).
// Used as a placeholder when a user has no linked wallet.
func ZeroPublicKey() sol.PublicKey {
	return sol.PublicKey{}
}

// PublicKeyFromBase58String converts a base58 string to a sol.PublicKey.
// Returns an error if the string is not a valid base58-encoded public key.
func PublicKeyFromBase58String(s string) (sol.PublicKey, error) {
	return sol.PublicKeyFromBase58(s)
}
