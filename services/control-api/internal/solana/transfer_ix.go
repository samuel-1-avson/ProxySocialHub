package solana

import (
	"context"
	"encoding/binary"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

// BuildSOLTransferIx is a System Program transfer (same encoding as SendSOL) for a
// sender whose key this client doesn't hold, e.g. a managed user wallet.
func BuildSOLTransferIx(from, to sol.PublicKey, lamports uint64) (sol.Instruction, error) {
	if lamports == 0 {
		return nil, fmt.Errorf("transfer amount must be positive")
	}
	data := make([]byte, 12)
	binary.LittleEndian.PutUint32(data[0:4], 2) // SystemInstruction::Transfer
	binary.LittleEndian.PutUint64(data[4:12], lamports)
	return &GenericInstruction{
		programID: sol.SystemProgramID,
		accounts: []*sol.AccountMeta{
			{PublicKey: from, IsSigner: true, IsWritable: true},
			{PublicKey: to, IsSigner: false, IsWritable: true},
		},
		data: data,
	}, nil
}

// SignatureStatus reports whether a transaction is known to the cluster and
// whether it is confirmed. A landed-but-failed transaction returns an error.
func (c *OracleClient) SignatureStatus(ctx context.Context, signature string) (found bool, confirmed bool, err error) {
	sig, err := sol.SignatureFromBase58(signature)
	if err != nil {
		return false, false, fmt.Errorf("invalid signature: %w", err)
	}
	var res *rpc.GetSignatureStatusesResult
	err = c.withFailover(ctx, func(client *rpc.Client) error {
		var callErr error
		res, callErr = client.GetSignatureStatuses(ctx, true, sig)
		return callErr
	})
	if err != nil {
		return false, false, err
	}
	if res == nil || len(res.Value) == 0 || res.Value[0] == nil {
		return false, false, nil
	}
	st := res.Value[0]
	if st.Err != nil {
		return true, false, fmt.Errorf("transaction %s failed on-chain: %v", signature, st.Err)
	}
	return true, st.ConfirmationStatus == rpc.ConfirmationStatusConfirmed || st.ConfirmationStatus == rpc.ConfirmationStatusFinalized, nil
}
