package solana

import (
	"encoding/binary"
	"testing"

	sol "github.com/gagliardetto/solana-go"
)

// BE-CRIT-05: the reserve refill must be signed by the reserve key and pay the
// treasury, not be a hot-wallet self-transfer.
func TestBuildSignedSOLTransfer_SignedByReserveToTreasury(t *testing.T) {
	reserve, err := sol.NewRandomPrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	treasury, err := sol.NewRandomPrivateKey()
	if err != nil {
		t.Fatal(err)
	}

	tx, err := BuildSignedSOLTransfer(reserve, treasury.PublicKey(), 1_500_000_000, sol.Hash{1})
	if err != nil {
		t.Fatalf("build: %v", err)
	}

	if !tx.Message.AccountKeys[0].Equals(reserve.PublicKey()) {
		t.Fatalf("fee payer/signer = %s, want reserve %s", tx.Message.AccountKeys[0], reserve.PublicKey())
	}
	if got := tx.Message.Header.NumRequiredSignatures; got != 1 {
		t.Fatalf("required signatures = %d, want 1", got)
	}
	if err := tx.VerifySignatures(); err != nil {
		t.Fatalf("signature does not verify: %v", err)
	}

	if len(tx.Message.Instructions) != 1 {
		t.Fatalf("instructions = %d, want 1", len(tx.Message.Instructions))
	}
	ix := tx.Message.Instructions[0]
	progID, err := tx.Message.Program(ix.ProgramIDIndex)
	if err != nil {
		t.Fatal(err)
	}
	if !progID.Equals(sol.SystemProgramID) {
		t.Fatalf("program = %s, want system program", progID)
	}
	if len(ix.Accounts) != 2 {
		t.Fatalf("instruction accounts = %d, want 2", len(ix.Accounts))
	}
	from := tx.Message.AccountKeys[ix.Accounts[0]]
	to := tx.Message.AccountKeys[ix.Accounts[1]]
	if !from.Equals(reserve.PublicKey()) || !to.Equals(treasury.PublicKey()) {
		t.Fatalf("transfer %s -> %s, want %s -> %s", from, to, reserve.PublicKey(), treasury.PublicKey())
	}
	if len(ix.Data) != 12 || binary.LittleEndian.Uint32(ix.Data[:4]) != 2 {
		t.Fatalf("unexpected instruction data %x", ix.Data)
	}
	if amt := binary.LittleEndian.Uint64(ix.Data[4:]); amt != 1_500_000_000 {
		t.Fatalf("amount = %d, want 1500000000", amt)
	}
}

func TestBuildSignedSOLTransfer_RejectsSelfTransferAndZero(t *testing.T) {
	key, err := sol.NewRandomPrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	other, _ := sol.NewRandomPrivateKey()

	if _, err := BuildSignedSOLTransfer(key, key.PublicKey(), 1, sol.Hash{}); err == nil {
		t.Fatal("expected error for sender == recipient")
	}
	if _, err := BuildSignedSOLTransfer(key, other.PublicKey(), 0, sol.Hash{}); err == nil {
		t.Fatal("expected error for zero amount")
	}
	if _, err := BuildSignedSOLTransfer(sol.PrivateKey{1, 2, 3}, other.PublicKey(), 1, sol.Hash{}); err == nil {
		t.Fatal("expected error for malformed key")
	}
}
