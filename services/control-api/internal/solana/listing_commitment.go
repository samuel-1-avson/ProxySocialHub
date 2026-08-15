// Package solana — on-chain listing commitment PDAs (Wave 5.C.5).
//
// Anchors an off-chain listing_offer_hash on-chain. Not a full catalog index.
// PDA seeds: ["listing-commitment", provider_pubkey, offer_hash_32]
package solana

import (
	"context"
	"encoding/hex"
	"fmt"
	"strings"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
)

var (
	discRegisterListingCommitment   = anchorDiscriminator("register_listing_commitment")
	discDeactivateListingCommitment = anchorDiscriminator("deactivate_listing_commitment")
)

// RegisterListingCommitmentParams holds data to anchor a listing offer hash.
type RegisterListingCommitmentParams struct {
	Provider  sol.PublicKey
	OfferHash [32]byte
	ListingID uuid.UUID
}

// ParseOfferHashHex decodes a 64-char hex SHA-256 listing_offer_hash into 32 bytes.
func ParseOfferHashHex(hexStr string) ([32]byte, error) {
	var out [32]byte
	raw := strings.TrimSpace(hexStr)
	if len(raw) != 64 {
		return out, fmt.Errorf("offer hash must be 64 hex chars, got %d", len(raw))
	}
	b, err := hex.DecodeString(raw)
	if err != nil {
		return out, fmt.Errorf("offer hash hex: %w", err)
	}
	if len(b) != 32 {
		return out, fmt.Errorf("offer hash must decode to 32 bytes")
	}
	copy(out[:], b)
	return out, nil
}

// ListingCommitmentPDA derives the ListingCommitment PDA for a program ID.
func ListingCommitmentPDA(programID, provider sol.PublicKey, offerHash [32]byte) (sol.PublicKey, uint8, error) {
	return sol.FindProgramAddress(
		[][]byte{[]byte("listing-commitment"), provider.Bytes(), offerHash[:]},
		programID,
	)
}

// GetListingCommitmentPDA derives the ListingCommitment PDA.
func (c *OracleClient) GetListingCommitmentPDA(provider sol.PublicKey, offerHash [32]byte) (sol.PublicKey, uint8, error) {
	return ListingCommitmentPDA(c.programID, provider, offerHash)
}

// RegisterListingCommitmentOnChain creates a ListingCommitment account.
// Oracle pays rent. Idempotent at the Go layer if the PDA already exists
// (caller may treat already-initialized as success).
func (c *OracleClient) RegisterListingCommitmentOnChain(ctx context.Context, params RegisterListingCommitmentParams) (string, error) {
	if params.OfferHash == [32]byte{} {
		return "", fmt.Errorf("offer hash must be non-zero")
	}

	commitmentPDA, _, err := c.GetListingCommitmentPDA(params.Provider, params.OfferHash)
	if err != nil {
		return "", fmt.Errorf("GetListingCommitmentPDA: %w", err)
	}
	statePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", fmt.Errorf("GetProgramStatePDA: %w", err)
	}

	// Borsh: [8] disc + [32] provider + [32] offer_hash + [16] listing_id
	data := make([]byte, 8+32+32+16)
	copy(data[0:8], discRegisterListingCommitment[:])
	copy(data[8:40], params.Provider.Bytes())
	copy(data[40:72], params.OfferHash[:])
	copy(data[72:88], params.ListingID[:])

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: commitmentPDA, IsSigner: false, IsWritable: true},
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: true},
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		},
		data: data,
	}

	return c.sendInstruction(ctx, instruction)
}

// DeactivateListingCommitmentOnChain marks a commitment inactive.
func (c *OracleClient) DeactivateListingCommitmentOnChain(ctx context.Context, provider sol.PublicKey, offerHash [32]byte) (string, error) {
	commitmentPDA, _, err := c.GetListingCommitmentPDA(provider, offerHash)
	if err != nil {
		return "", fmt.Errorf("GetListingCommitmentPDA: %w", err)
	}
	statePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return "", fmt.Errorf("GetProgramStatePDA: %w", err)
	}

	data := make([]byte, 8+32+32)
	copy(data[0:8], discDeactivateListingCommitment[:])
	copy(data[8:40], provider.Bytes())
	copy(data[40:72], offerHash[:])

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: commitmentPDA, IsSigner: false, IsWritable: true},
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: false},
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},
		},
		data: data,
	}

	return c.sendInstruction(ctx, instruction)
}
