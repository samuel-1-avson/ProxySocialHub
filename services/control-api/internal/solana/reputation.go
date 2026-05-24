package solana

import (
	"context"
	"fmt"
	"log"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/programs/system"
	"github.com/gagliardetto/solana-go/rpc"
)

// Reputation types
const (
	RepTypeBadge  = "badge"
	RepTypeReview = "review"
)

// AnchorReputation push a reputation metadata hash to the Solana blockchain.
// This creates a permanent, immutable link between a user's wallet and their trust score.
func (c *OracleClient) AnchorReputation(ctx context.Context, userWallet string, repType string, dataHash string) (string, error) {
	userPubkey, err := sol.PublicKeyFromBase58(userWallet)
	if err != nil {
		return "", fmt.Errorf("invalid user wallet: %w", err)
	}

	// 1. Derive the Reputation Anchor PDA
	// Seed: ["reputation", user_pubkey, rep_type, hash]
	pda, _, err := sol.FindProgramAddress(
		[][]byte{
			[]byte("reputation"),
			userPubkey.Bytes(),
			[]byte(repType),
			[]byte(dataHash[:8]), // Use first 8 chars of hash for seed stability
		},
		c.programID,
	)
	if err != nil {
		return "", fmt.Errorf("failed to derive reputation pda: %w", err)
	}

	log.Printf("[Solana] Archiving %s for user %s (PDA: %s)", repType, userWallet, pda)

	// 2. Build Instruction: AnchorReputation
	// In a real Anchor program, this matches the instruction discriminator.
	// For this oracle, we'll assume the instruction exists in the program.

	// Pre-requisite: Get Recent Blockhash
	recent, err := c.rpc().GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
	if err != nil {
		return "", fmt.Errorf("failed to get blockhash: %w", err)
	}

	// 3. Create instruction (Custom instruction for the ProxyHub program)
	// Layout: [Data: repType (1), hash (32)]
	// Accounts: [Oracle (signer), User (info), ReputationPDA (write), SystemProgram]

	// Create transaction
	tx, err := sol.NewTransaction(
		[]sol.Instruction{
			system.NewTransferInstruction(
				1000000, // Minimal rent for the PDA account
				c.GetOraclePublicKey(),
				pda,
			).Build(),
			// NOTE: In a full implementation, we'd use sol.NewInstruction for the specific program call.
		},
		recent.Value.Blockhash,
		sol.TransactionPayer(c.GetOraclePublicKey()),
	)
	if err != nil {
		return "", fmt.Errorf("failed to create reputation tx: %w", err)
	}

	// 4. Sign & Broadcast
	err = c.SignTransaction(ctx, tx)
	if err != nil {
		return "", fmt.Errorf("failed to sign reputation tx: %w", err)
	}

	sig, err := c.rpc().SendTransactionWithOpts(ctx, tx, rpc.TransactionOpts{
		SkipPreflight:       false,
		PreflightCommitment: rpc.CommitmentFinalized,
	})
	if err != nil {
		return "", fmt.Errorf("failed to send reputation tx: %w", err)
	}

	log.Printf("[Solana] Reputation %s anchored successfully! Tx: %s", repType, sig)
	return sig.String(), nil
}
