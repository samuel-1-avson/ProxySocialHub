package zk

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testBatch() *BatchProof {
	return &BatchProof{
		Root:         [32]byte{0x11},
		LeafHashes:   [][32]byte{{0x22}},
		SessionCount: 1,
		TotalBytes:   1000,
		PeriodStart:  1,
		PeriodEnd:    2,
	}
}

func TestGroth16Client_DisabledNotRequired(t *testing.T) {
	c := NewGroth16Client("", defaultGroth16Timeout, false)
	_, err := c.ProveBatchHeader(context.Background(), testBatch())
	if err == nil {
		t.Fatal("expected error when URL empty")
	}
}

func TestGroth16Client_RequiredWithoutURL(t *testing.T) {
	c := NewGroth16Client("", defaultGroth16Timeout, true)
	_, err := c.ProveBatchHeader(context.Background(), testBatch())
	if err == nil || !strings.Contains(err.Error(), "GROTH16_PROVER_URL") {
		t.Fatalf("want URL required error, got %v", err)
	}
}

func TestGroth16Client_RequiresLeaves(t *testing.T) {
	c := NewGroth16Client("http://127.0.0.1:9", defaultGroth16Timeout, true)
	_, err := c.ProveBatchHeader(context.Background(), &BatchProof{
		Root: [32]byte{1}, SessionCount: 1, TotalBytes: 1,
	})
	if err == nil || !strings.Contains(err.Error(), "leaf") {
		t.Fatalf("want leaf error, got %v", err)
	}
}

func TestGroth16Client_Success(t *testing.T) {
	wire := make([]byte, Groth16ProofWireLen)
	wire[0] = 0xAB
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/prove/batch-groth16" {
			t.Fatalf("path %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(Groth16ProveResponse{
			ProofBase64: base64.StdEncoding.EncodeToString(wire),
			VKHashHex:   ExpectedBatchGroth16VKHashHex,
		})
	}))
	defer srv.Close()

	c := NewGroth16Client(srv.URL, defaultGroth16Timeout, true)
	b := testBatch()
	b.SessionCount = 1
	got, err := c.ProveBatchHeader(context.Background(), b)
	if err != nil {
		t.Fatal(err)
	}
	if got[0] != 0xAB {
		t.Fatalf("proof[0]=%x", got[0])
	}
}

func TestGroth16Client_VKHashMismatch(t *testing.T) {
	wire := make([]byte, Groth16ProofWireLen)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(Groth16ProveResponse{
			ProofBase64: base64.StdEncoding.EncodeToString(wire),
			VKHashHex:   "00",
		})
	}))
	defer srv.Close()
	c := NewGroth16Client(srv.URL, defaultGroth16Timeout, true)
	_, err := c.ProveBatchHeader(context.Background(), testBatch())
	if err == nil || !strings.Contains(err.Error(), "vk_hash") {
		t.Fatalf("want vk_hash error, got %v", err)
	}
}
