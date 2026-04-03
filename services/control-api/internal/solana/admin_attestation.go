// Package solana — admin attestation on-chain client (AUTH-001/007).
//
// An AdminAttestation PDA is written by the program admin when a user is
// promoted to an admin role.  Sensitive endpoints verify this PDA in addition
// to the JWT role claim, making privilege escalation require both a compromised
// JWT secret AND a compromised Solana admin keypair.
//
// Account order for write_admin_attestation:
//   0  admin        — Signer, writable (must be program_state.admin)
//   1  attestation  — init_if_needed PDA ["admin_attestation", wallet]
//   2  system_program
//   3  program_state
package solana

import (
	"context"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

var discWriteAdminAttestation = anchorDiscriminator("write_admin_attestation")

// Admin role constants (mirror the Anchor program u8 values).
const (
	AdminRoleModerator  uint8 = 0
	AdminRoleAdmin      uint8 = 1
	AdminRoleSuperAdmin uint8 = 2
)

// AdminAttestationData is returned by ReadAdminAttestation.
type AdminAttestationData struct {
	AdminWallet sol.PublicKey
	Oracle      sol.PublicKey
	Role        uint8
	AttestedAt  int64
}

// GetAdminAttestationPDA derives the admin attestation PDA for a wallet.
func (c *OracleClient) GetAdminAttestationPDA(wallet sol.PublicKey) (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{[]byte("admin_attestation"), wallet.Bytes()},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("GetAdminAttestationPDA: %w", err)
	}
	return pda, bump, nil
}

// WriteAdminAttestation sends a write_admin_attestation instruction.
// The caller must be the program admin (oracle key must equal program_state.admin).
// role: 0=moderator, 1=admin, 2=super_admin.
func (c *OracleClient) WriteAdminAttestation(ctx context.Context, wallet sol.PublicKey, role uint8) (string, error) {
	attestPDA, _, err := c.GetAdminAttestationPDA(wallet)
	if err != nil {
		return "", err
	}

	statePDA, _, _ := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)

	// Data: disc(8) + wallet(32) + role(1) = 41
	data := make([]byte, 41)
	copy(data[0:8], discWriteAdminAttestation[:])
	copy(data[8:40], wallet.Bytes())
	data[40] = role

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: true}, // admin (must be program_state.admin)
			{PublicKey: attestPDA, IsSigner: false, IsWritable: true},              // attestation PDA
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},   // system_program
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},              // program_state
		},
		data: data,
	}

	return c.sendInstruction(ctx, instruction)
}

// ReadAdminAttestation fetches and decodes the on-chain AdminAttestation PDA.
// Returns an error if no attestation exists (use IsAdminAttested for a bool check).
//
// Layout after 8-byte discriminator:
//   [0:32]  admin_wallet (Pubkey)
//   [32:64] oracle       (Pubkey)
//   [64]    role         (u8)
//   [65:73] attested_at  (i64 LE)
//   [73]    bump         (u8)
func (c *OracleClient) ReadAdminAttestation(ctx context.Context, wallet sol.PublicKey) (*AdminAttestationData, error) {
	attestPDA, _, err := c.GetAdminAttestationPDA(wallet)
	if err != nil {
		return nil, err
	}

	var accountInfo *rpc.GetAccountInfoResult
	if fetchErr := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		accountInfo, e = client.GetAccountInfo(ctx, attestPDA)
		return e
	}); fetchErr != nil {
		return nil, fmt.Errorf("ReadAdminAttestation: RPC error: %w", fetchErr)
	}
	if accountInfo == nil || accountInfo.Value == nil {
		return nil, fmt.Errorf("ReadAdminAttestation: no attestation for wallet %s", wallet)
	}

	raw := accountInfo.Value.Data.GetBinary()
	if len(raw) < 74 {
		return nil, fmt.Errorf("ReadAdminAttestation: data too short")
	}

	body := raw[8:]
	att := &AdminAttestationData{}
	copy(att.AdminWallet[:], body[0:32])
	copy(att.Oracle[:], body[32:64])
	att.Role = body[64]
	att.AttestedAt = int64(body[65]) | int64(body[66])<<8 | int64(body[67])<<16 | int64(body[68])<<24 |
		int64(body[69])<<32 | int64(body[70])<<40 | int64(body[71])<<48 | int64(body[72])<<56
	return att, nil
}

// IsAdminAttested returns true if the wallet has a valid AdminAttestation PDA.
func (c *OracleClient) IsAdminAttested(ctx context.Context, wallet sol.PublicKey) (bool, error) {
	_, err := c.ReadAdminAttestation(ctx, wallet)
	if err != nil {
		// "no attestation" is not an RPC error — treat as false
		return false, nil
	}
	return true, nil
}
