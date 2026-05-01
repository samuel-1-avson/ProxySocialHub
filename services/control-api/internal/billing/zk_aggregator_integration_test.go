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
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/zk"
)

func TestZKAggregator_SubmitBatchDirect_PersistsProofBytesFromRealProver(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	proverURL := strings.TrimSpace(os.Getenv("HALO2_PROVER_URL"))
	keypairPath := strings.TrimSpace(os.Getenv("SOLANA_ORACLE_KEYPAIR"))
	if dsn == "" {
		t.Skip("integration test requires DATABASE_URL")
	}
	if proverURL == "" {
		t.Skip("integration test requires HALO2_PROVER_URL")
	}
	if keypairPath == "" {
		t.Skip("integration test requires SOLANA_ORACLE_KEYPAIR")
	}
	if _, err := os.Stat(keypairPath); err != nil {
		t.Skipf("integration test requires a readable SOLANA_ORACLE_KEYPAIR file: %v", err)
	}

	t.Setenv("HALO2_PROVER_URL", proverURL)
	t.Setenv("HALO2_PROVER_REQUIRED", "true")
	t.Setenv("HALO2_PROVER_TIMEOUT_MS", "30000")
	t.Setenv("SOLANA_ORACLE_KEYPAIR", keypairPath)

	if err := solana.InitOracleFromEnv(); err != nil {
		t.Fatalf("failed to init Solana oracle: %v", err)
	}
	if solana.GetOracleClient() == nil {
		t.Fatal("Solana oracle was not configured; check SOLANA_ORACLE_KEYPAIR and SOLANA_RPC_ENDPOINT")
	}

	if err := waitForProverHealthy(proverURL, 20, 500*time.Millisecond); err != nil {
		t.Fatalf("real prover is not healthy: %v", err)
	}

	if db.DB == nil {
		if err := db.Init(dsn); err != nil {
			t.Fatalf("failed to initialize DB for integration test: %v", err)
		}
		t.Cleanup(db.Close)
	}
	if err := db.DB.AutoMigrate(&models.ZKBatch{}); err != nil {
		t.Fatalf("auto migrate zk_batch model: %v", err)
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
	err = agg.SubmitBatchDirect(context.Background(), batch, rootHex)
	if err != nil && decentralization.FullModeEnabled() {
		t.Fatalf("SubmitBatchDirect failed in FULL_DECENTRALIZATION mode: %v", err)
	}
	if err != nil {
		t.Logf("SubmitBatchDirect returned error (treated as chain simulation): %v", err)
	}

	var stored models.ZKBatch
	if err := db.DB.Where("batch_root = ?", rootHex).First(&stored).Error; err != nil {
		t.Fatalf("failed to fetch persisted zk_batch: %v", err)
	}
	if len(stored.ProofBytes) == 0 {
		t.Fatalf("expected non-empty proof_bytes, got %d", len(stored.ProofBytes))
	}
	if err == nil {
		if stored.Status != models.ZKBatchConfirmed {
			t.Fatalf("expected status %q, got %q", models.ZKBatchConfirmed, stored.Status)
		}
		if stored.OnChainTxSig == "" {
			t.Fatal("expected non-empty on_chain_tx_sig")
		}
		return
	}

	// When running against an environment without the Solana program deployed,
	// submission is simulated by verifying we attempted the RPC and persisted
	// proof bytes while marking the batch failed.
	if stored.Status != models.ZKBatchFailed {
		t.Fatalf("expected status %q after simulated submission failure, got %q", models.ZKBatchFailed, stored.Status)
	}
	if !strings.Contains(err.Error(), "ProgramAccountNotFound") && !strings.Contains(err.Error(), "program that does not exist") {
		t.Fatalf("unexpected SubmitBatchDirect failure: %v", err)
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
