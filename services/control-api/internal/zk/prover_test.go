package zk

import (
	"testing"
)

func TestGenerateBatchProof_Single(t *testing.T) {
	leaf := ProofLeaf{
		SessionID:   [16]byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16},
		TotalBytes:  1_000_000,
		PeriodStart: 1_700_000_000,
		PeriodEnd:   1_700_000_900,
		BuyerSig:    []byte("fakebuyersig"),
		ProviderSig: []byte("fakeprovidersig"),
	}

	p := NewProver()
	batch, err := p.GenerateBatchProof([]ProofLeaf{leaf})
	if err != nil {
		t.Fatalf("GenerateBatchProof: %v", err)
	}
	if batch.SessionCount != 1 {
		t.Errorf("expected session count 1, got %d", batch.SessionCount)
	}
	if batch.TotalBytes != 1_000_000 {
		t.Errorf("expected total bytes 1000000, got %d", batch.TotalBytes)
	}
	// Root must be non-zero.
	var zero [32]byte
	if batch.Root == zero {
		t.Error("expected non-zero batch root")
	}
}

func TestGenerateBatchProof_Multiple(t *testing.T) {
	leaves := make([]ProofLeaf, 5)
	for i := range leaves {
		leaves[i] = ProofLeaf{
			SessionID:   [16]byte{byte(i)},
			TotalBytes:  uint64(i+1) * 500_000,
			PeriodStart: 1_700_000_000,
			PeriodEnd:   1_700_000_900,
			BuyerSig:    []byte("buyer"),
			ProviderSig: []byte("provider"),
		}
	}

	p := NewProver()
	batch, err := p.GenerateBatchProof(leaves)
	if err != nil {
		t.Fatalf("GenerateBatchProof: %v", err)
	}
	if batch.SessionCount != 5 {
		t.Errorf("expected 5 sessions, got %d", batch.SessionCount)
	}
	// Total bytes: (1+2+3+4+5) * 500_000 = 7_500_000
	if batch.TotalBytes != 7_500_000 {
		t.Errorf("expected total bytes 7500000, got %d", batch.TotalBytes)
	}
}

func TestVerifyLeafInclusion(t *testing.T) {
	leaf := ProofLeaf{
		SessionID:   [16]byte{42},
		TotalBytes:  99_999,
		PeriodStart: 100,
		PeriodEnd:   200,
		BuyerSig:    []byte("b"),
		ProviderSig: []byte("p"),
	}
	otherLeaf := ProofLeaf{
		SessionID:   [16]byte{99},
		TotalBytes:  1,
		PeriodStart: 100,
		PeriodEnd:   200,
		BuyerSig:    []byte("x"),
		ProviderSig: []byte("y"),
	}

	p := NewProver()
	batch, err := p.GenerateBatchProof([]ProofLeaf{leaf})
	if err != nil {
		t.Fatalf("GenerateBatchProof: %v", err)
	}

	if !VerifyLeafInclusion(batch, leaf) {
		t.Error("expected leaf to be included in batch")
	}
	if VerifyLeafInclusion(batch, otherLeaf) {
		t.Error("expected other leaf to NOT be included in batch")
	}
}

func TestGenerateBatchProof_Empty(t *testing.T) {
	p := NewProver()
	_, err := p.GenerateBatchProof(nil)
	if err == nil {
		t.Error("expected error for empty leaves")
	}
}

func TestMerkleRoot_Deterministic(t *testing.T) {
	leaves := []ProofLeaf{
		{SessionID: [16]byte{1}, TotalBytes: 100, BuyerSig: []byte("a"), ProviderSig: []byte("b")},
		{SessionID: [16]byte{2}, TotalBytes: 200, BuyerSig: []byte("c"), ProviderSig: []byte("d")},
		{SessionID: [16]byte{3}, TotalBytes: 300, BuyerSig: []byte("e"), ProviderSig: []byte("f")},
	}

	p := NewProver()
	b1, _ := p.GenerateBatchProof(leaves)
	b2, _ := p.GenerateBatchProof(leaves)

	if b1.Root != b2.Root {
		t.Error("Merkle root is not deterministic for the same inputs")
	}
}
