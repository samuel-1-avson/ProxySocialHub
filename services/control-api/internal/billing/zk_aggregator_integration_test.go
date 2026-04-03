//go:build integration

package billing

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/zk"
)

func TestZKAggregator_SubmitBatchDirect_PersistsProofBytesFromRealProver(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	proverURL := strings.TrimSpace(os.Getenv("HALO2_PROVER_URL"))
	if dsn == "" {
		t.Skip("integration test requires DATABASE_URL")
	}
	if proverURL == "" {
		t.Skip("integration test requires HALO2_PROVER_URL")
	}

	t.Setenv("HALO2_PROVER_URL", proverURL)
	t.Setenv("HALO2_PROVER_REQUIRED", "true")
	t.Setenv("HALO2_PROVER_TIMEOUT_MS", "30000")

	if err := waitForProverHealthy(proverURL, 20, 500*time.Millisecond); err != nil {
		t.Fatalf("real prover is not healthy: %v", err)
	}

	if db.DB == nil {
		if err := db.Init(dsn); err != nil {
			t.Fatalf("failed to initialize DB for integration test: %v", err)
		}
		t.Cleanup(db.Close)
	}

	batch, err := buildIntegrationBatch()
	if err != nil {
		t.Fatalf("failed to build integration batch: %v", err)
	}
	rootHex := hex.EncodeToString(batch.Root[:])

	pending := models.ZKBatch{
		BatchRoot:    rootHex,
		SessionCount: batch.SessionCount,
		TotalBytes:   batch.TotalBytes,
		PeriodStart:  time.Unix(batch.PeriodStart, 0),
		PeriodEnd:    time.Unix(batch.PeriodEnd, 0),
		Status:       models.ZKBatchPending,
	}
	if err := db.DB.Create(&pending).Error; err != nil {
		t.Fatalf("failed to create pending zk_batch row: %v", err)
	}
	t.Cleanup(func() {
		db.DB.Where("batch_root = ?", rootHex).Delete(&models.ZKBatch{})
	})

	agg := NewZKAggregator()
	if err := agg.SubmitBatchDirect(context.Background(), batch, rootHex); err != nil {
		t.Fatalf("SubmitBatchDirect failed: %v", err)
	}

	var stored models.ZKBatch
	if err := db.DB.Where("batch_root = ?", rootHex).First(&stored).Error; err != nil {
		t.Fatalf("failed to fetch persisted zk_batch: %v", err)
	}
	if stored.Status != models.ZKBatchConfirmed {
		t.Fatalf("expected status %q, got %q", models.ZKBatchConfirmed, stored.Status)
	}
	if len(stored.ProofBytes) == 0 {
		t.Fatalf("expected non-empty proof_bytes, got %d", len(stored.ProofBytes))
	}
	if stored.OnChainTxSig == "" {
		t.Fatal("expected non-empty on_chain_tx_sig")
	}
}

func buildIntegrationBatch() (*zk.BatchProof, error) {
	now := time.Now().UTC().Unix()
	leaves := make([]zk.ProofLeaf, 2)
	for i := range leaves {
		var sid [16]byte
		if _, err := rand.Read(sid[:]); err != nil {
			return nil, fmt.Errorf("rand session id: %w", err)
		}
		buyerSig := make([]byte, 64)
		providerSig := make([]byte, 64)
		if _, err := rand.Read(buyerSig); err != nil {
			return nil, fmt.Errorf("rand buyer sig: %w", err)
		}
		if _, err := rand.Read(providerSig); err != nil {
			return nil, fmt.Errorf("rand provider sig: %w", err)
		}

		leaves[i] = zk.ProofLeaf{
			SessionID:   sid,
			TotalBytes:  uint64(1024 * (i + 1)),
			PeriodStart: now - 900,
			PeriodEnd:   now,
			BuyerSig:    buyerSig,
			ProviderSig: providerSig,
		}
	}

	return zk.NewProver().GenerateBatchProof(leaves)
}

func waitForProverHealthy(baseURL string, retries int, delay time.Duration) error {
	url := strings.TrimRight(baseURL, "/") + "/healthz"
	client := &http.Client{Timeout: 3 * time.Second}

	var lastErr error
	for i := 0; i < retries; i++ {
		resp, err := client.Get(url)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return nil
			}
			lastErr = fmt.Errorf("unexpected status %d", resp.StatusCode)
		} else {
			lastErr = err
		}
		time.Sleep(delay)
	}

	return fmt.Errorf("health check failed for %s: %w", url, lastErr)
}
