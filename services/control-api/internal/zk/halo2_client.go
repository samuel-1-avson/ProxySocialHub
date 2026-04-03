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
	"strconv"
	"strings"
	"time"
)

const defaultHalo2Timeout = 10 * time.Second

// Halo2Client calls an external prover service that returns proof bytes for a
// batch root commitment.
type Halo2Client struct {
	baseURL    string
	httpClient *http.Client
	required   bool
}

// Halo2BatchProofRequest is the wire request for the prover service.
type Halo2BatchProofRequest struct {
	BatchRoot    string   `json:"batch_root"`
	SessionCount uint32   `json:"session_count"`
	TotalBytes   uint64   `json:"total_bytes"`
	PeriodStart  int64    `json:"period_start"`
	PeriodEnd    int64    `json:"period_end"`
	LeafHashes   []string `json:"leaf_hashes"`
}

// Halo2BatchProofResponse is the prover response payload.
type Halo2BatchProofResponse struct {
	ProofBase64   string   `json:"proof_base64"`
	ProofSystem   string   `json:"proof_system,omitempty"`
	PublicSignals []string `json:"public_signals,omitempty"`
}

// NewHalo2ClientFromEnv creates a prover client from process environment.
//
// Environment:
// - HALO2_PROVER_URL: base URL of the prover service, e.g. http://zk-prover:8095
// - HALO2_PROVER_TIMEOUT_MS: optional HTTP timeout in milliseconds
// - HALO2_PROVER_REQUIRED: when true, batch submission fails if prover is disabled or unavailable
func NewHalo2ClientFromEnv() *Halo2Client {
	baseURL := strings.TrimSpace(os.Getenv("HALO2_PROVER_URL"))
	timeout := parseTimeoutFromEnv("HALO2_PROVER_TIMEOUT_MS", defaultHalo2Timeout)
	required := parseBoolFromEnv("HALO2_PROVER_REQUIRED", false)

	return NewHalo2Client(baseURL, timeout, required)
}

// NewHalo2Client creates a prover client.
func NewHalo2Client(baseURL string, timeout time.Duration, required bool) *Halo2Client {
	if timeout <= 0 {
		timeout = defaultHalo2Timeout
	}

	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")

	return &Halo2Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: timeout,
		},
		required: required,
	}
}

// Enabled returns true when a prover base URL is configured.
func (c *Halo2Client) Enabled() bool {
	return c != nil && c.baseURL != ""
}

// Required returns true when prover failures should fail settlement.
func (c *Halo2Client) Required() bool {
	return c != nil && c.required
}

// GenerateBatchProof calls the prover and returns serialized proof bytes.
// If the client is not enabled and not required, it returns nil, nil.
func (c *Halo2Client) GenerateBatchProof(ctx context.Context, batch *BatchProof) ([]byte, error) {
	if batch == nil {
		return nil, fmt.Errorf("nil batch")
	}

	if c == nil || c.baseURL == "" {
		if c != nil && c.required {
			return nil, fmt.Errorf("HALO2 prover is required but HALO2_PROVER_URL is not configured")
		}
		return nil, nil
	}

	body, err := json.Marshal(c.buildRequest(batch))
	if err != nil {
		return nil, fmt.Errorf("marshal halo2 request: %w", err)
	}

	endpoint := c.baseURL + "/v1/prove/batch"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build halo2 request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call halo2 prover: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read halo2 response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("halo2 prover returned %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	var parsed Halo2BatchProofResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("decode halo2 response: %w", err)
	}

	if strings.TrimSpace(parsed.ProofBase64) == "" {
		return nil, fmt.Errorf("halo2 prover returned empty proof")
	}

	proofBytes, err := base64.StdEncoding.DecodeString(parsed.ProofBase64)
	if err != nil {
		return nil, fmt.Errorf("decode proof_base64: %w", err)
	}
	if len(proofBytes) == 0 {
		return nil, fmt.Errorf("halo2 prover returned zero-length proof")
	}

	return proofBytes, nil
}

func (c *Halo2Client) buildRequest(batch *BatchProof) Halo2BatchProofRequest {
	leafHashes := make([]string, 0, len(batch.LeafHashes))
	for _, h := range batch.LeafHashes {
		leafHashes = append(leafHashes, hex.EncodeToString(h[:]))
	}

	return Halo2BatchProofRequest{
		BatchRoot:    hex.EncodeToString(batch.Root[:]),
		SessionCount: batch.SessionCount,
		TotalBytes:   batch.TotalBytes,
		PeriodStart:  batch.PeriodStart,
		PeriodEnd:    batch.PeriodEnd,
		LeafHashes:   leafHashes,
	}
}

func parseTimeoutFromEnv(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}

	ms, err := strconv.Atoi(raw)
	if err != nil || ms <= 0 {
		return fallback
	}
	return time.Duration(ms) * time.Millisecond
}

func parseBoolFromEnv(key string, fallback bool) bool {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if raw == "" {
		return fallback
	}

	switch raw {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}
