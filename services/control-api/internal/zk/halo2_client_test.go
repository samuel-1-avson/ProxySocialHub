package zk

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHalo2ClientGenerateBatchProof_DisabledNotRequired(t *testing.T) {
	client := NewHalo2Client("", 2*time.Second, false)
	batch := testBatchProof()

	proof, err := client.GenerateBatchProof(context.Background(), batch)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(proof) != 0 {
		t.Fatalf("expected empty proof for disabled client, got %d bytes", len(proof))
	}
}

func TestHalo2ClientGenerateBatchProof_RequiredWithoutURL(t *testing.T) {
	client := NewHalo2Client("", 2*time.Second, true)
	batch := testBatchProof()

	_, err := client.GenerateBatchProof(context.Background(), batch)
	if err == nil {
		t.Fatal("expected error when prover is required but URL is not configured")
	}
}

func TestHalo2ClientGenerateBatchProof_Success(t *testing.T) {
	expected := []byte("proof-bytes")

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/prove/batch" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"proof_base64":"` + base64.StdEncoding.EncodeToString(expected) + `","proof_system":"halo2"}`))
	}))
	defer ts.Close()

	client := NewHalo2Client(ts.URL, 2*time.Second, true)
	batch := testBatchProof()

	proof, err := client.GenerateBatchProof(context.Background(), batch)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(proof) != string(expected) {
		t.Fatalf("unexpected proof bytes: %q", string(proof))
	}
}

func TestHalo2ClientGenerateBatchProof_HTTPError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
	}))
	defer ts.Close()

	client := NewHalo2Client(ts.URL, 2*time.Second, true)
	batch := testBatchProof()

	_, err := client.GenerateBatchProof(context.Background(), batch)
	if err == nil {
		t.Fatal("expected non-nil error for non-2xx prover response")
	}
}

func testBatchProof() *BatchProof {
	return &BatchProof{
		Root:         [32]byte{1, 2, 3, 4},
		LeafHashes:   [][32]byte{{9, 8, 7, 6}},
		SessionCount: 1,
		TotalBytes:   1024,
		PeriodStart:  100,
		PeriodEnd:    200,
	}
}
