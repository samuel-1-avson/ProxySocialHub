// Package solana — review attestation on-chain client (REP-001).
//
// Submits an immutable ReviewAttestation PDA when a buyer reviews an order.
// The PDA stores the SHA-256 hash of the review content, making it tamper-
// evident without storing plaintext on-chain (which would be expensive).
//
// PDA seeds: ["review", order_escrow_pda (32 bytes), reviewer_wallet (32 bytes)]
//
// Account order for submit_review_attestation:
//   0  oracle              — Signer, writable (pays rent); must equal program_state.admin
//   1  review_attestation  — init PDA
//   2  system_program
//   3  program_state       — admin binding (appended by the P1-SC-2 hardening)
package solana

import (
	"context"
	"crypto/sha256"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

var discSubmitReviewAttestation = anchorDiscriminator("submit_review_attestation")

// ReviewAttestationParams holds parameters for submitting a review attestation.
type ReviewAttestationParams struct {
	OrderEscrowPDA sol.PublicKey
	Reviewer       sol.PublicKey
	// RatingHash is SHA-256(rating_string + comment + review_uuid).
	// Compute with ComputeRatingHash before calling SubmitReviewAttestation.
	RatingHash [32]byte
}

// ReviewAttestationData is returned by ReadReviewAttestation.
type ReviewAttestationData struct {
	OrderEscrowPDA sol.PublicKey
	Reviewer       sol.PublicKey
	RatingHash     [32]byte
	AttestedAt     int64
}

// ComputeRatingHash produces the SHA-256 hash used in the ReviewAttestation PDA.
// rating is the numeric rating string (e.g. "4"), comment is the review text,
// reviewID is the UUID string of the DB review row.
func ComputeRatingHash(rating string, comment string, reviewID string) [32]byte {
	h := sha256.Sum256([]byte(rating + "|" + comment + "|" + reviewID))
	return h
}

// GetReviewAttestationPDA derives the review attestation PDA.
func (c *OracleClient) GetReviewAttestationPDA(escrowPDA sol.PublicKey, reviewer sol.PublicKey) (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{[]byte("review"), escrowPDA.Bytes(), reviewer.Bytes()},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("GetReviewAttestationPDA: %w", err)
	}
	return pda, bump, nil
}

// SubmitReviewAttestation sends a submit_review_attestation instruction.
// Oracle pays rent.  Returns the review attestation PDA and tx signature.
func (c *OracleClient) SubmitReviewAttestation(ctx context.Context, params ReviewAttestationParams) (sol.PublicKey, string, error) {
	reviewPDA, _, err := c.GetReviewAttestationPDA(params.OrderEscrowPDA, params.Reviewer)
	if err != nil {
		return sol.PublicKey{}, "", err
	}

	// The program binds the oracle to program_state.admin, so it needs that account.
	programStatePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, c.programID)
	if err != nil {
		return sol.PublicKey{}, "", fmt.Errorf("SubmitReviewAttestation: program_state PDA: %w", err)
	}

	// Data: disc(8) + order_escrow_pda(32) + reviewer(32) + rating_hash(32) = 104
	data := make([]byte, 104)
	copy(data[0:8], discSubmitReviewAttestation[:])
	copy(data[8:40], params.OrderEscrowPDA.Bytes())
	copy(data[40:72], params.Reviewer.Bytes())
	copy(data[72:104], params.RatingHash[:])

	instruction := &GenericInstruction{
		programID: c.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: c.oracleKey.PublicKey(), IsSigner: true, IsWritable: true}, // oracle
			{PublicKey: reviewPDA, IsSigner: false, IsWritable: true},              // review_attestation
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},   // system_program
			{PublicKey: programStatePDA, IsSigner: false, IsWritable: false},       // program_state (appended last)
		},
		data: data,
	}

	sig, err := c.sendInstruction(ctx, instruction)
	return reviewPDA, sig, err
}

// ReadReviewAttestation fetches and decodes the on-chain ReviewAttestation.
//
// Layout after 8-byte discriminator:
//   [0:32]  order_escrow_pda (Pubkey)
//   [32:64] reviewer         (Pubkey)
//   [64:96] rating_hash      ([u8;32])
//   [96:104] attested_at     (i64 LE)
//   [104]   bump             (u8)
func (c *OracleClient) ReadReviewAttestation(ctx context.Context, escrowPDA sol.PublicKey, reviewer sol.PublicKey) (*ReviewAttestationData, error) {
	reviewPDA, _, err := c.GetReviewAttestationPDA(escrowPDA, reviewer)
	if err != nil {
		return nil, err
	}

	var accountInfo *rpc.GetAccountInfoResult
	if fetchErr := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		accountInfo, e = client.GetAccountInfo(ctx, reviewPDA)
		return e
	}); fetchErr != nil {
		return nil, fmt.Errorf("ReadReviewAttestation: RPC error: %w", fetchErr)
	}
	if accountInfo == nil || accountInfo.Value == nil {
		return nil, fmt.Errorf("ReadReviewAttestation: no attestation found")
	}

	raw := accountInfo.Value.Data.GetBinary()
	if len(raw) < 105 {
		return nil, fmt.Errorf("ReadReviewAttestation: data too short")
	}

	body := raw[8:]
	rev := &ReviewAttestationData{}
	copy(rev.OrderEscrowPDA[:], body[0:32])
	copy(rev.Reviewer[:], body[32:64])
	copy(rev.RatingHash[:], body[64:96])
	// i64 LE from 8 bytes
	v := uint64(body[96]) | uint64(body[97])<<8 | uint64(body[98])<<16 | uint64(body[99])<<24 |
		uint64(body[100])<<32 | uint64(body[101])<<40 | uint64(body[102])<<48 | uint64(body[103])<<56
	rev.AttestedAt = int64(v)
	return rev, nil
}
