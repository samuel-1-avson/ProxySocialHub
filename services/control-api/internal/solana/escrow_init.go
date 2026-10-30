package solana

import (
	"context"
	"encoding/binary"
	"fmt"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

// EscrowAccountLen is Escrow::LEN in programs/proxyhub (discriminator + fields).
const EscrowAccountLen = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 8 + 8 + 32 + 8 + 1

var (
	discInitializeEscrow         = anchorDiscriminator("initialize_escrow")
	discInitializeEscrowMultisig = anchorDiscriminator("initialize_escrow_multisig")
)

// InitializeEscrowParams mirrors the web initializeEscrow / initializeEscrowMultisig
// calls (apps/web/src/lib/solana.ts). Buyer signs, funds and receives refunds.
type InitializeEscrowParams struct {
	Buyer          sol.PublicKey
	Seller         sol.PublicKey
	EscrowPDA      sol.PublicKey
	AmountLamports uint64
	LimitUnits     uint64 // micro-GiB, see LimitUnitsFromGiB
	ExpiresAt      int64
	Multisig       bool
}

// BuildInitializeEscrowIx builds initialize_escrow (or initialize_escrow_multisig).
// Args are Borsh: amount u64, bandwidth_limit_gb u64, expires_at i64, all little-endian.
func BuildInitializeEscrowIx(programID sol.PublicKey, p InitializeEscrowParams) (sol.Instruction, error) {
	if p.AmountLamports == 0 || p.LimitUnits == 0 {
		return nil, fmt.Errorf("initialize_escrow: amount and bandwidth limit must be positive")
	}
	data := make([]byte, 8+8+8+8)
	if p.Multisig {
		copy(data[0:8], discInitializeEscrowMultisig[:])
	} else {
		copy(data[0:8], discInitializeEscrow[:])
	}
	binary.LittleEndian.PutUint64(data[8:16], p.AmountLamports)
	binary.LittleEndian.PutUint64(data[16:24], p.LimitUnits)
	binary.LittleEndian.PutUint64(data[24:32], uint64(p.ExpiresAt))

	accounts := []*sol.AccountMeta{
		{PublicKey: p.EscrowPDA, IsSigner: false, IsWritable: true},
		{PublicKey: p.Buyer, IsSigner: true, IsWritable: true},
		{PublicKey: p.Seller, IsSigner: false, IsWritable: false},
	}
	if p.Multisig {
		statePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, programID)
		if err != nil {
			return nil, fmt.Errorf("initialize_escrow_multisig: program_state PDA: %w", err)
		}
		priceOraclePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("price_oracle")}, programID)
		if err != nil {
			return nil, fmt.Errorf("initialize_escrow_multisig: price_oracle PDA: %w", err)
		}
		accounts = append(accounts,
			&sol.AccountMeta{PublicKey: statePDA, IsSigner: false, IsWritable: false},
			&sol.AccountMeta{PublicKey: priceOraclePDA, IsSigner: false, IsWritable: false},
		)
	}
	accounts = append(accounts, &sol.AccountMeta{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false})

	return &GenericInstruction{programID: programID, accounts: accounts, data: data}, nil
}

// EscrowRentLamports is the rent-exempt minimum for one escrow account.
func (c *OracleClient) EscrowRentLamports(ctx context.Context) (uint64, error) {
	var rent uint64
	err := c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		rent, err = client.GetMinimumBalanceForRentExemption(ctx, EscrowAccountLen, rpc.CommitmentConfirmed)
		return err
	})
	if err != nil {
		return 0, fmt.Errorf("escrow rent: %w", err)
	}
	return rent, nil
}

// LatestBlockhash returns a recent blockhash for building transactions signed
// outside this client (for example by a managed user wallet).
func (c *OracleClient) LatestBlockhash(ctx context.Context) (sol.Hash, error) {
	// Confirmed is ~13s fresher than finalized, which leaves more of the ~60s
	// blockhash validity window for the transaction to land.
	res, err := c.getLatestBlockhashWithRetry(ctx, rpc.CommitmentConfirmed)
	if err != nil {
		return sol.Hash{}, err
	}
	return res.Value.Blockhash, nil
}

// SendSignedTransaction submits a transaction that is already fully signed.
func (c *OracleClient) SendSignedTransaction(ctx context.Context, tx *sol.Transaction) (string, error) {
	var sig sol.Signature
	err := c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		sig, err = client.SendTransaction(ctx, tx)
		return err
	})
	if err != nil {
		return "", err
	}
	return sig.String(), nil
}

// WaitForConfirmation polls until the signature is confirmed, fails on-chain, or
// the timeout passes.
func (c *OracleClient) WaitForConfirmation(ctx context.Context, signature string, timeout time.Duration) error {
	sig, err := sol.SignatureFromBase58(signature)
	if err != nil {
		return fmt.Errorf("invalid signature: %w", err)
	}
	deadline := time.Now().Add(timeout)
	for {
		var res *rpc.GetSignatureStatusesResult
		err := c.withFailover(ctx, func(client *rpc.Client) error {
			var err error
			res, err = client.GetSignatureStatuses(ctx, true, sig)
			return err
		})
		if err == nil && res != nil && len(res.Value) > 0 && res.Value[0] != nil {
			st := res.Value[0]
			if st.Err != nil {
				return fmt.Errorf("transaction %s failed on-chain: %v", signature, st.Err)
			}
			if st.ConfirmationStatus == rpc.ConfirmationStatusConfirmed || st.ConfirmationStatus == rpc.ConfirmationStatusFinalized {
				return nil
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("transaction %s not confirmed within %s", signature, timeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(400 * time.Millisecond):
		}
	}
}
