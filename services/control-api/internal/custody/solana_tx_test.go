package custody

import (
	"crypto/ed25519"
	"testing"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/programs/system"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestSignTransactionSignsAsManagedWallet(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "embedded_wallets", "users", "wallets")
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("custody-tx"), "buyer")
	kek := randomKEK(t)
	row, err := CreateSolanaWallet(db.DB, kek, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := NewSigner(db.DB, kek, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	from := sol.MustPublicKeyFromBase58(row.Address)

	tx, err := sol.NewTransaction(
		[]sol.Instruction{system.NewTransferInstruction(1000, from, sol.NewWallet().PublicKey()).Build()},
		sol.Hash{1, 2, 3},
		sol.TransactionPayer(from),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := signer.SignTransaction(tx); err != nil {
		t.Fatalf("sign tx: %v", err)
	}
	msg, _ := tx.Message.MarshalBinary()
	if !ed25519.Verify(ed25519.PublicKey(from.Bytes()), msg, tx.Signatures[0][:]) {
		t.Fatal("transaction signature does not verify against the managed address")
	}

	// A transaction this wallet does not need to sign is refused.
	other := sol.NewWallet().PublicKey()
	tx2, _ := sol.NewTransaction(
		[]sol.Instruction{system.NewTransferInstruction(1, other, from).Build()},
		sol.Hash{4}, sol.TransactionPayer(other),
	)
	if err := signer.SignTransaction(tx2); err == nil {
		t.Fatal("expected refusal when the wallet is not a required signer")
	}
}
