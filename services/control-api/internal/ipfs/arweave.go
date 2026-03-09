package ipfs

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// ArweaveClient handles uploads to Arweave via Irys (formerly Bundlr)
type ArweaveClient struct {
	IrysEndpoint   string
	IrysToken      string
	ArweaveGateway string
	httpClient     *http.Client
}

// ArweaveUploadResponse represents the response from Irys
type ArweaveUploadResponse struct {
	ID             string `json:"id"`
	Timestamp      int64  `json:"timestamp"`
	Version        string `json:"version"`
	Public         string `json:"public"`
	Signature      string `json:"signature"`
	DeadlineHeight int64  `json:"deadlineHeight"`
	Block          int64  `json:"block"`
}

// NewArweaveClient creates a new Arweave client
func NewArweaveClient() *ArweaveClient {
	endpoint := os.Getenv("IRYS_ENDPOINT")
	if endpoint == "" {
		endpoint = "https://node1.irys.xyz"
	}

	gateway := os.Getenv("ARWEAVE_GATEWAY")
	if gateway == "" {
		gateway = "https://arweave.net"
	}

	return &ArweaveClient{
		IrysEndpoint:   endpoint,
		IrysToken:      os.Getenv("IRYS_TOKEN"),
		ArweaveGateway: gateway,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// UploadData uploads data to Arweave via Irys
func (c *ArweaveClient) UploadData(data []byte, contentType string, tags map[string]string) (string, error) {
	if c.IrysToken == "" {
		return "", fmt.Errorf("Irys token not configured - Arweave upload unavailable")
	}

	// Prepare the upload request
	req, err := http.NewRequest("POST", c.IrysEndpoint+"/tx/solana", bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+c.IrysToken)

	// Add tags as headers
	for key, value := range tags {
		req.Header.Set("X-Tag-"+key, value)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to upload to Irys: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("Irys upload failed: %s - %s", resp.Status, string(body))
	}

	var result ArweaveUploadResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	return result.ID, nil
}

// UploadSessionProof uploads a session proof to Arweave
func (c *ArweaveClient) UploadSessionProof(proof SessionProof) (string, error) {
	data, err := json.Marshal(proof)
	if err != nil {
		return "", fmt.Errorf("failed to marshal proof: %w", err)
	}

	tags := map[string]string{
		"App-Name":     "ProxySocialHub",
		"Content-Type": "application/json",
		"Proof-Type":   proof.ProofType,
		"Session-ID":   proof.SessionID,
	}

	return c.UploadData(data, "application/json", tags)
}

// FetchFromArweave retrieves data from Arweave
func (c *ArweaveClient) FetchFromArweave(txID string) ([]byte, error) {
	url := c.ArweaveGateway + "/" + txID

	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch from Arweave: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Arweave fetch failed: %s", resp.Status)
	}

	return io.ReadAll(resp.Body)
}

// SessionProof represents a proof of session activity
type SessionProof struct {
	SessionID      string    `json:"session_id"`
	ProofType      string    `json:"proof_type"` // "usage", "quality", "attestation"
	BuyerWallet    string    `json:"buyer_wallet"`
	ProviderWallet string    `json:"provider_wallet"`
	GatewayWallet  string    `json:"gateway_wallet"`
	BytesUsed      uint64    `json:"bytes_used"`
	RequestsCount  uint64    `json:"requests_count"`
	QualityScore   uint8     `json:"quality_score"`
	StartTime      time.Time `json:"start_time"`
	EndTime        time.Time `json:"end_time"`
	DataHash       string    `json:"data_hash"` // SHA256 of raw usage data
	Signature      string    `json:"signature"` // Provider signature
}

// StorageClient interface for pluggable storage backends
type StorageClient interface {
	UploadText(content string) (string, error)
	UploadData(data []byte, contentType string) (string, error)
	Fetch(cid string) ([]byte, error)
}

// DualStorageClient uploads to both IPFS (fast) and Arweave (permanent)
type DualStorageClient struct {
	ipfs    *IPFSClient
	arweave *ArweaveClient
}

// NewDualStorageClient creates a client that uses both IPFS and Arweave
func NewDualStorageClient() *DualStorageClient {
	return &DualStorageClient{
		ipfs:    NewClient(),
		arweave: NewArweaveClient(),
	}
}

// UploadWithPermanence uploads to IPFS first (fast), then Arweave (permanent)
func (d *DualStorageClient) UploadWithPermanence(data []byte, contentType string) (ipfsCid string, arweaveTx string, err error) {
	// Upload to IPFS first (faster, for immediate access)
	ipfsCid, err = d.ipfs.UploadData(data)
	if err != nil {
		return "", "", fmt.Errorf("IPFS upload failed: %w", err)
	}

	// Upload to Arweave (permanent storage)
	tags := map[string]string{
		"App-Name":     "ProxySocialHub",
		"Content-Type": contentType,
		"IPFS-CID":     ipfsCid,
	}
	arweaveTx, err = d.arweave.UploadData(data, contentType, tags)
	if err != nil {
		// Log but don't fail - IPFS upload succeeded
		fmt.Printf("Warning: Arweave upload failed: %v\n", err)
		arweaveTx = ""
	}

	return ipfsCid, arweaveTx, nil
}

// UploadSessionProof uploads a session proof to both IPFS and Arweave
func (d *DualStorageClient) UploadSessionProof(proof SessionProof) (ipfsCid string, arweaveTx string, err error) {
	data, err := json.Marshal(proof)
	if err != nil {
		return "", "", fmt.Errorf("failed to marshal proof: %w", err)
	}

	return d.UploadWithPermanence(data, "application/json")
}
