package custody

import (
	"fmt"

	sol "github.com/gagliardetto/solana-go"
)

// SignTransaction adds this wallet's signature to tx. The wallet must be one of
// the transaction's required signers; other signer slots are left untouched.
func (s *Signer) SignTransaction(tx *sol.Transaction) error {
	addr, err := sol.PublicKeyFromBase58(s.row.Address)
	if err != nil {
		return fmt.Errorf("custody: invalid wallet address: %w", err)
	}
	n := int(tx.Message.Header.NumRequiredSignatures)
	slot := -1
	for i := 0; i < n && i < len(tx.Message.AccountKeys); i++ {
		if tx.Message.AccountKeys[i].Equals(addr) {
			slot = i
			break
		}
	}
	if slot < 0 {
		return fmt.Errorf("custody: wallet %s is not a required signer", s.row.Address)
	}

	msg, err := tx.Message.MarshalBinary()
	if err != nil {
		return fmt.Errorf("custody: marshal message: %w", err)
	}
	sig, err := s.Sign(msg)
	if err != nil {
		return err
	}
	if len(tx.Signatures) < n {
		sigs := make([]sol.Signature, n)
		copy(sigs, tx.Signatures)
		tx.Signatures = sigs
	}
	copy(tx.Signatures[slot][:], sig)
	return nil
}
