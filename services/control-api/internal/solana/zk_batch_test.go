package solana

import (
	"crypto/sha256"
	"testing"
)

func TestEncodeSubmitZKBatchDataLayout(t *testing.T) {
	var root [32]byte
	root[0] = 0xAA
	var proof [32]byte
	proof[0] = 0xDD

	data := EncodeSubmitZKBatchData(ZKBatchParams{
		BatchRoot:    root,
		SessionCount: 10,
		TotalBytes:   1_000_000_000,
		PeriodStart:  1700000000,
		PeriodEnd:    1700003600,
		ProofHash:    proof,
	})
	if len(data) != 100 {
		t.Fatalf("len=%d want 100 (disc+root+count+bytes+start+end+proof_hash)", len(data))
	}
	if data[8] != 0xAA {
		t.Fatalf("batch_root[0]=%x want AA", data[8])
	}
	if data[68] != 0xDD {
		t.Fatalf("proof_hash[0]=%x want DD", data[68])
	}
	// discriminator must be non-zero Anchor sighash
	allZero := true
	for _, b := range data[0:8] {
		if b != 0 {
			allZero = false
			break
		}
	}
	if allZero {
		t.Fatal("discriminator is all zeros")
	}
}

func TestProofHashFromBytes(t *testing.T) {
	empty := ProofHashFromBytes(nil)
	if empty != ([32]byte{}) {
		t.Fatalf("empty proof should yield zero hash")
	}
	want := sha256.Sum256([]byte("halo2-blob"))
	got := ProofHashFromBytes([]byte("halo2-blob"))
	if got != want {
		t.Fatalf("proof hash mismatch")
	}
}
