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

func TestEncodeSubmitZKBatchGroth16DataLayout(t *testing.T) {
	var root, proof, vk, leaves [32]byte
	root[0], proof[0], vk[0], leaves[0] = 0xAA, 0xDD, 0xEE, 0xCC
	data := EncodeSubmitZKBatchGroth16Data(ZKBatchGroth16Params{
		ZKBatchParams: ZKBatchParams{
			BatchRoot:    root,
			SessionCount: 3,
			TotalBytes:   100,
			PeriodStart:  1,
			PeriodEnd:    2,
			ProofHash:    proof,
		},
		LeavesHash: leaves,
		VKHash:     vk,
	})
	if len(data) != 420 {
		t.Fatalf("len=%d want 420", len(data))
	}
	if data[68] != 0xCC {
		t.Fatalf("leaves_hash[0]=%x want CC", data[68])
	}
	if data[132] != 0xEE {
		t.Fatalf("vk_hash[0]=%x want EE", data[132])
	}
	oracleDisc := EncodeSubmitZKBatchData(ZKBatchParams{})
	same := true
	for i := 0; i < 8; i++ {
		if data[i] != oracleDisc[i] {
			same = false
			break
		}
	}
	if same {
		t.Fatal("groth16 discriminator must differ from submit_zk_batch")
	}
}

func TestBatchGroth16VKHash(t *testing.T) {
	h := BatchGroth16VKHash()
	if h == ([32]byte{}) {
		t.Fatal("VK hash must be non-zero")
	}
	data := EncodeSubmitZKBatchGroth16Data(ZKBatchGroth16Params{
		ZKBatchParams: ZKBatchParams{BatchRoot: [32]byte{1}, SessionCount: 1, TotalBytes: 1, ProofHash: [32]byte{2}},
		LeavesHash:    [32]byte{3},
	})
	for i := 0; i < 32; i++ {
		if data[132+i] != h[i] {
			t.Fatalf("zero VKHash should default to BatchGroth16VKHash at offset %d", i)
		}
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
