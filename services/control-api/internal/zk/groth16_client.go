package zk

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	defaultGroth16Timeout = 30 * time.Second
	// Groth16ProofWireLen is A(64)||B(128)||C(64) for submit_zk_batch_groth16.
	Groth16ProofWireLen = 256
	// ExpectedBatchGroth16VKHashHex must match solana.BatchGroth16VKHashHex / on-chain VK_HASH.
	ExpectedBatchGroth16VKHashHex = "2f1075c22786a7763bfaee9ec39188b2aec7fb19de0aa1c3aac9e7ce29519e72"
)

// Groth16Client calls the BN254 batch-header Groth16 prover service.
type Groth16Client struct {
	baseURL    string
	httpClient *http.Client
	required   bool
}

// Groth16ProveRequest is POST /v1/prove/batch-groth16 body (digest-v2).
type Groth16ProveRequest struct {
	BatchRoot    string `json:"batch_root"`
	SessionCount uint32 `json:"session_count"`
	TotalBytes   uint64 `json:"total_bytes"`
	PeriodStart  int64  `json:"period_start"`
	PeriodEnd    int64  `json:"period_end"`
	LeavesHash   string `json:"leaves_hash"`
}

// Groth16ProveResponse is the prover response.
type Groth16ProveResponse struct {
	ProofBase64     string `json:"proof_base64"`
	ProofSystem     string `json:"proof_system,omitempty"`
	VKHashHex       string `json:"vk_hash_hex,omitempty"`
	PublicInputHex  string `json:"public_input_hex,omitempty"`
}

// NewGroth16ClientFromEnv builds a client from GROTH16_PROVER_* env vars.
//
//   - GROTH16_PROVER_URL — e.g. http://groth16-prover:8096
//   - GROTH16_PROVER_TIMEOUT_MS — optional
//   - GROTH16_PROVER_REQUIRED — when true, fail if URL missing / prove fails
//     (also implied when PROXYHUB_ZK_ONCHAIN_GROTH16 is on — see aggregator)
func NewGroth16ClientFromEnv() *Groth16Client {
	baseURL := strings.TrimSpace(os.Getenv("GROTH16_PROVER_URL"))
	timeout := parseTimeoutFromEnv("GROTH16_PROVER_TIMEOUT_MS", defaultGroth16Timeout)
	required := parseBoolFromEnv("GROTH16_PROVER_REQUIRED", false)
	return NewGroth16Client(baseURL, timeout, required)
}

// NewGroth16Client creates a BN254 Groth16 prover client.
func NewGroth16Client(baseURL string, timeout time.Duration, required bool) *Groth16Client {
	if timeout <= 0 {
		timeout = defaultGroth16Timeout
	}
	return &Groth16Client{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		httpClient: &http.Client{
			Timeout: timeout,
		},
		required: required,
	}
}

// Enabled reports whether a prover URL is configured.
func (c *Groth16Client) Enabled() bool {
	return c != nil && c.baseURL != ""
}

// Required reports whether prove failures must fail settlement.
func (c *Groth16Client) Required() bool {
	return c != nil && c.required
}

// ProveBatchHeader returns the 256-byte wire proof for on-chain verify.
func (c *Groth16Client) ProveBatchHeader(ctx context.Context, batch *BatchProof) ([256]byte, error) {
	var out [256]byte
	if batch == nil {
		return out, fmt.Errorf("nil batch")
	}
	if c == nil || c.baseURL == "" {
		if c != nil && c.required {
			return out, fmt.Errorf("GROTH16 prover is required but GROTH16_PROVER_URL is not configured")
		}
		return out, fmt.Errorf("GROTH16 prover URL not configured")
	}

	if len(batch.LeafHashes) == 0 {
		return out, fmt.Errorf("groth16 digest-v2: batch has no leaf hashes")
	}
	if uint32(len(batch.LeafHashes)) != batch.SessionCount {
		return out, fmt.Errorf(
			"groth16 digest-v2: leaf count %d != session_count %d",
			len(batch.LeafHashes), batch.SessionCount,
		)
	}
	leavesHex, err := LeavesHashHex(batch.LeafHashes)
	if err != nil {
		return out, fmt.Errorf("leaves_hash: %w", err)
	}

	body, err := json.Marshal(Groth16ProveRequest{
		BatchRoot:    hex.EncodeToString(batch.Root[:]),
		SessionCount: batch.SessionCount,
		TotalBytes:   batch.TotalBytes,
		PeriodStart:  batch.PeriodStart,
		PeriodEnd:    batch.PeriodEnd,
		LeavesHash:   leavesHex,
	})
	if err != nil {
		return out, fmt.Errorf("marshal groth16 request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/prove/batch-groth16", bytes.NewReader(body))
	if err != nil {
		return out, fmt.Errorf("build groth16 request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return out, fmt.Errorf("call groth16 prover: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return out, fmt.Errorf("read groth16 response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return out, fmt.Errorf("groth16 prover returned %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	var parsed Groth16ProveResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return out, fmt.Errorf("decode groth16 response: %w", err)
	}
	if vh := strings.TrimSpace(strings.ToLower(parsed.VKHashHex)); vh != "" && vh != ExpectedBatchGroth16VKHashHex {
		return out, fmt.Errorf("groth16 prover vk_hash %s != expected %s", vh, ExpectedBatchGroth16VKHashHex)
	}

	proofBytes, err := base64.StdEncoding.DecodeString(parsed.ProofBase64)
	if err != nil {
		return out, fmt.Errorf("decode proof_base64: %w", err)
	}
	if len(proofBytes) != Groth16ProofWireLen {
		return out, fmt.Errorf("groth16 proof length %d, want %d", len(proofBytes), Groth16ProofWireLen)
	}
	copy(out[:], proofBytes)
	return out, nil
}
