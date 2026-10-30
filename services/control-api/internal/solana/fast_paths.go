package solana

import (
	"context"
	"crypto/ed25519"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

// Fast paths for flows a user is actively waiting on (card checkout). They read at
// "confirmed" instead of "finalized" (about 1-2s instead of about 13s behind) and
// put several steps into one transaction.

type confirmedReadsKey struct{}

// WithConfirmedReads makes escrow reads on ctx use "confirmed" commitment, so an
// escrow this server just saw confirm is visible immediately.
func WithConfirmedReads(ctx context.Context) context.Context {
	return context.WithValue(ctx, confirmedReadsKey{}, true)
}

func readCommitment(ctx context.Context) rpc.CommitmentType {
	if v, _ := ctx.Value(confirmedReadsKey{}).(bool); v {
		return rpc.CommitmentConfirmed
	}
	return "" // RPC default (finalized), unchanged for existing callers
}

// GetBalanceFresh reads a confirmed balance without the short-lived balance cache,
// for decisions made right after a transfer.
func (c *OracleClient) GetBalanceFresh(ctx context.Context, pubkey sol.PublicKey) (uint64, error) {
	var res *rpc.GetBalanceResult
	err := c.withFailover(ctx, func(client *rpc.Client) error {
		var callErr error
		res, callErr = client.GetBalance(ctx, pubkey, rpc.CommitmentConfirmed)
		return callErr
	})
	if err != nil {
		return 0, err
	}
	return res.Value, nil
}

// CheckOutflow applies the same velocity limits as SendSOL to SOL that leaves the
// treasury inside a larger transaction.
func (c *OracleClient) CheckOutflow(ctx context.Context, lamports uint64) error {
	if c.velocity == nil {
		return fmt.Errorf("outflow blocked: VelocityGuard not initialised")
	}
	return c.velocity.Check(ctx, LamportsToSOL(lamports))
}

// SignTransactionPartial signs every required slot whose key this client holds and
// leaves the others (e.g. a managed user wallet) for their own signer.
func (c *OracleClient) SignTransactionPartial(ctx context.Context, tx *sol.Transaction) error {
	msgBytes, err := tx.Message.MarshalBinary()
	if err != nil {
		return fmt.Errorf("failed to marshal transaction message: %w", err)
	}
	n := int(tx.Message.Header.NumRequiredSignatures)
	if len(tx.Signatures) < n {
		sigs := make([]sol.Signature, n)
		copy(sigs, tx.Signatures)
		tx.Signatures = sigs
	}
	for i := 0; i < n; i++ {
		key := tx.Message.AccountKeys[i]
		var sigBytes []byte
		switch {
		case c.hotHsm != nil && key.Equals(c.hotHsm.PublicKey()):
			if sigBytes, err = c.hotHsm.Sign(ctx, msgBytes); err != nil {
				return fmt.Errorf("failed to sign with hot HSM: %w", err)
			}
		case len(c.treasuryHotKey) > 0 && key.Equals(c.treasuryHotKey.PublicKey()):
			sigBytes = ed25519.Sign(ed25519.PrivateKey(c.treasuryHotKey), msgBytes)
		case c.hsm != nil && key.Equals(c.hsm.PublicKey()):
			if sigBytes, err = c.hsm.Sign(ctx, msgBytes); err != nil {
				return fmt.Errorf("failed to sign with HSM: %w", err)
			}
		case len(c.oracleKey) > 0 && key.Equals(c.oracleKey.PublicKey()):
			sigBytes = ed25519.Sign(ed25519.PrivateKey(c.oracleKey), msgBytes)
		default:
			continue
		}
		copy(tx.Signatures[i][:], sigBytes)
	}
	return nil
}

// BuildFundAndInitEscrowTx builds one transaction that (1) sends fundLamports from the
// treasury payout wallet to the buyer and (2) runs initialize_escrow with that buyer.
// The treasury pays the network fee. It is signed by the treasury here; the buyer
// (a managed wallet) must add its own signature before sending.
func (c *OracleClient) BuildFundAndInitEscrowTx(ctx context.Context, fundLamports uint64, p InitializeEscrowParams) (*sol.Transaction, error) {
	payer := c.GetPayoutPublicKey()
	var ixs []sol.Instruction
	if fundLamports > 0 {
		if err := c.CheckOutflow(ctx, fundLamports); err != nil {
			return nil, err
		}
		fund, err := BuildSOLTransferIx(payer, p.Buyer, fundLamports)
		if err != nil {
			return nil, err
		}
		ixs = append(ixs, fund)
	}
	initIx, err := BuildInitializeEscrowIx(c.programID, p)
	if err != nil {
		return nil, err
	}
	ixs = append(ixs, initIx)

	bh, err := c.getLatestBlockhashWithRetry(ctx, rpc.CommitmentConfirmed)
	if err != nil {
		return nil, fmt.Errorf("blockhash: %w", err)
	}
	tx, err := sol.NewTransaction(ixs, bh.Value.Blockhash, sol.TransactionPayer(payer))
	if err != nil {
		return nil, err
	}
	if err := c.SignTransactionPartial(ctx, tx); err != nil {
		return nil, err
	}
	return tx, nil
}
