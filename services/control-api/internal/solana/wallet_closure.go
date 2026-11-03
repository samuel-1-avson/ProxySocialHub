package solana

import (
	"context"
	"errors"
	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

// CheckWalletEmpty deliberately refuses to destroy a key while either SOL or
// any SPL token account (including rent-bearing empty accounts) remains.
func (c *OracleClient) CheckWalletEmpty(ctx context.Context, address string) error {
	key, err := sol.PublicKeyFromBase58(address)
	if err != nil {
		return err
	}
	return c.withFailover(ctx, func(client *rpc.Client) error {
		balance, err := client.GetBalance(ctx, key, rpc.CommitmentFinalized)
		if err != nil {
			return err
		}
		if balance.Value != 0 {
			return errors.New("managed wallet still holds SOL")
		}
		for _, program := range []string{"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"} {
			p := sol.MustPublicKeyFromBase58(program)
			accounts, err := client.GetTokenAccountsByOwner(ctx, key, &rpc.GetTokenAccountsConfig{ProgramId: &p}, &rpc.GetTokenAccountsOpts{Commitment: rpc.CommitmentFinalized})
			if err != nil {
				return err
			}
			if len(accounts.Value) != 0 {
				return errors.New("managed wallet has token accounts; move assets and close accounts first")
			}
		}
		return nil
	})
}
