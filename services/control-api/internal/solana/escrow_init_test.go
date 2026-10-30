package solana

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/binary"
	"testing"

	sol "github.com/gagliardetto/solana-go"
)

func TestBuildInitializeEscrowIx_MatchesIDLLayout(t *testing.T) {
	programID := sol.MustPublicKeyFromBase58(ProgramID)
	buyer := sol.NewWallet().PublicKey()
	seller := sol.NewWallet().PublicKey()
	pda := sol.NewWallet().PublicKey()

	ix, err := BuildInitializeEscrowIx(programID, InitializeEscrowParams{
		Buyer: buyer, Seller: seller, EscrowPDA: pda,
		AmountLamports: 123_456_789, LimitUnits: 2_000_000, ExpiresAt: 1_900_000_000,
	})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := ix.Data()

	want := sha256.Sum256([]byte("global:initialize_escrow"))
	if !bytes.Equal(data[:8], want[:8]) {
		t.Fatalf("discriminator mismatch")
	}
	if len(data) != 32 {
		t.Fatalf("data len = %d, want 32", len(data))
	}
	if binary.LittleEndian.Uint64(data[8:16]) != 123_456_789 ||
		binary.LittleEndian.Uint64(data[16:24]) != 2_000_000 ||
		int64(binary.LittleEndian.Uint64(data[24:32])) != 1_900_000_000 {
		t.Fatalf("args not encoded as u64/u64/i64 LE")
	}

	accts := ix.Accounts()
	if len(accts) != 4 {
		t.Fatalf("accounts = %d, want 4 (escrow, buyer, seller, system)", len(accts))
	}
	if !accts[0].PublicKey.Equals(pda) || !accts[0].IsWritable || accts[0].IsSigner {
		t.Fatal("escrow meta wrong")
	}
	if !accts[1].PublicKey.Equals(buyer) || !accts[1].IsSigner || !accts[1].IsWritable {
		t.Fatal("buyer must be a writable signer")
	}
	if !accts[2].PublicKey.Equals(seller) || accts[2].IsSigner {
		t.Fatal("seller meta wrong")
	}
	if !accts[3].PublicKey.Equals(sol.SystemProgramID) {
		t.Fatal("last account must be the system program")
	}
}

func TestBuildInitializeEscrowIx_Multisig(t *testing.T) {
	programID := sol.MustPublicKeyFromBase58(ProgramID)
	ix, err := BuildInitializeEscrowIx(programID, InitializeEscrowParams{
		Buyer: sol.NewWallet().PublicKey(), Seller: sol.NewWallet().PublicKey(), EscrowPDA: sol.NewWallet().PublicKey(),
		AmountLamports: 1, LimitUnits: 1, ExpiresAt: 1_900_000_000, Multisig: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := ix.Data()
	want := sha256.Sum256([]byte("global:initialize_escrow_multisig"))
	if !bytes.Equal(data[:8], want[:8]) {
		t.Fatal("multisig discriminator mismatch")
	}
	state, _, _ := sol.FindProgramAddress([][]byte{[]byte("program_state")}, programID)
	oracle, _, _ := sol.FindProgramAddress([][]byte{[]byte("price_oracle")}, programID)
	accts := ix.Accounts()
	if len(accts) != 6 || !accts[3].PublicKey.Equals(state) || !accts[4].PublicKey.Equals(oracle) {
		t.Fatal("multisig accounts must be escrow, buyer, seller, program_state, price_oracle, system")
	}
}

func TestBuildInitializeEscrowIx_RejectsZero(t *testing.T) {
	programID := sol.MustPublicKeyFromBase58(ProgramID)
	if _, err := BuildInitializeEscrowIx(programID, InitializeEscrowParams{LimitUnits: 1}); err == nil {
		t.Fatal("expected error for zero amount")
	}
}

func TestBuildSOLTransferIx(t *testing.T) {
	from, to := sol.NewWallet().PublicKey(), sol.NewWallet().PublicKey()
	ix, err := BuildSOLTransferIx(from, to, 1_500_000)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := ix.Data()
	if len(data) != 12 || binary.LittleEndian.Uint32(data[0:4]) != 2 || binary.LittleEndian.Uint64(data[4:12]) != 1_500_000 {
		t.Fatalf("bad transfer data: %x", data)
	}
	a := ix.Accounts()
	if !ix.ProgramID().Equals(sol.SystemProgramID) || !a[0].PublicKey.Equals(from) || !a[0].IsSigner || !a[1].PublicKey.Equals(to) || a[1].IsSigner {
		t.Fatal("bad transfer accounts")
	}
	if _, err := BuildSOLTransferIx(from, to, 0); err == nil {
		t.Fatal("zero transfer must fail")
	}
}

func TestSignTransactionPartialLeavesOtherSigners(t *testing.T) {
	oracleKey := sol.NewWallet().PrivateKey
	c := &OracleClient{oracleKey: oracleKey}
	user := sol.NewWallet().PublicKey()

	fund, _ := BuildSOLTransferIx(oracleKey.PublicKey(), user, 1000)
	back, _ := BuildSOLTransferIx(user, oracleKey.PublicKey(), 1) // makes the user a required signer
	tx, err := sol.NewTransaction([]sol.Instruction{fund, back}, sol.Hash{7}, sol.TransactionPayer(oracleKey.PublicKey()))
	if err != nil {
		t.Fatal(err)
	}
	if err := c.SignTransactionPartial(context.Background(), tx); err != nil {
		t.Fatalf("partial sign: %v", err)
	}
	msg, _ := tx.Message.MarshalBinary()
	if !ed25519.Verify(ed25519.PublicKey(oracleKey.PublicKey().Bytes()), msg, tx.Signatures[0][:]) {
		t.Fatal("oracle slot not signed")
	}
	if !tx.Signatures[1].IsZero() {
		t.Fatal("user slot must be left for the user's signer")
	}
}

func TestEscrowAccountLenMatchesProgram(t *testing.T) {
	if EscrowAccountLen != 154 {
		t.Fatalf("EscrowAccountLen = %d, want 154 (Escrow::LEN)", EscrowAccountLen)
	}
}
