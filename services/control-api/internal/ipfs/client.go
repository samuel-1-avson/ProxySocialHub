package ipfs

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
)

// IPFSClient handles interactions with IPFS via Pinata or local node
type IPFSClient struct {
	GatewayURL   string
	PinataJWT    string
	PinataAPIURL string
	UsePinata    bool
}

// PinataResponse represents the response from Pinata API
type PinataResponse struct {
	IpfsHash  string `json:"IpfsHash"`
	PinSize   int    `json:"PinSize"`
	Timestamp string `json:"Timestamp"`
}

// NewClient creates an IPFS client (uses Pinata if configured, otherwise local)
func NewClient() *IPFSClient {
	pinataJWT := os.Getenv("PINATA_JWT")

	return &IPFSClient{
		GatewayURL:   getEnvOrDefault("IPFS_GATEWAY", "https://gateway.pinata.cloud/ipfs/"),
		PinataJWT:    pinataJWT,
		PinataAPIURL: "https://api.pinata.cloud",
		UsePinata:    pinataJWT != "",
	}
}

func getEnvOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

// UploadText uploads text content to IPFS and returns the CID
func (c *IPFSClient) UploadText(content string) (string, error) {
	if c.UsePinata {
		return c.uploadToPinata(content)
	}
	return c.uploadToLocalNode(content)
}

// uploadToPinata uploads content to Pinata's pinning service
func (c *IPFSClient) uploadToPinata(content string) (string, error) {
	url := fmt.Sprintf("%s/pinning/pinFileToIPFS", c.PinataAPIURL)

	// Create multipart form data
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	// Add the file
	part, err := writer.CreateFormFile("file", "content.txt")
	if err != nil {
		return "", fmt.Errorf("failed to create form file: %w", err)
	}
	if _, err := io.WriteString(part, content); err != nil {
		return "", fmt.Errorf("failed to write content: %w", err)
	}

	// Add metadata
	metadata := map[string]interface{}{
		"name": fmt.Sprintf("proxyhubb_%d", time.Now().Unix()),
	}
	metadataJSON, _ := json.Marshal(metadata)
	if err := writer.WriteField("pinataMetadata", string(metadataJSON)); err != nil {
		return "", fmt.Errorf("failed to add metadata: %w", err)
	}

	writer.Close()

	// Create request
	req, err := http.NewRequest("POST", url, &buf)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+c.PinataJWT)

	// Execute request
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("pinata request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("pinata returned status %d: %s", resp.StatusCode, string(body))
	}

	var pinataResp PinataResponse
	if err := json.NewDecoder(resp.Body).Decode(&pinataResp); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	logging.Info().
		Str("cid", pinataResp.IpfsHash).
		Int("size", pinataResp.PinSize).
		Msg("Content pinned to IPFS via Pinata")

	return pinataResp.IpfsHash, nil
}

// uploadToLocalNode uploads to a local IPFS node (fallback)
func (c *IPFSClient) uploadToLocalNode(content string) (string, error) {
	// Try local IPFS node at default port
	localNode := os.Getenv("IPFS_NODE_URL")
	if localNode == "" {
		localNode = "http://localhost:5001"
	}

	url := fmt.Sprintf("%s/api/v0/add", localNode)

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", "content.txt")
	if err != nil {
		return "", fmt.Errorf("failed to create form: %w", err)
	}
	if _, err := io.WriteString(part, content); err != nil {
		return "", fmt.Errorf("failed to write: %w", err)
	}
	writer.Close()

	req, err := http.NewRequest("POST", url, &buf)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		logging.Warn().Err(err).Msg("Local IPFS node not available, using hash-based CID")
		// Fallback: generate deterministic hash (for dev/testing only)
		return c.generateFallbackCID(content), nil
	}
	defer resp.Body.Close()

	var result struct {
		Hash string `json:"Hash"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Hash, nil
}

// generateFallbackCID creates a deterministic CID for dev/testing
// WARNING: This should NOT be used in production
func (c *IPFSClient) generateFallbackCID(content string) string {
	hash := sha256.Sum256([]byte(content))
	// Create a fake but deterministic CID
	return fmt.Sprintf("Qm%s", hex.EncodeToString(hash[:]))[:46]
}

// GetGatewayURL returns the public URL for a given CID
func (c *IPFSClient) GetGatewayURL(cid string) string {
	return fmt.Sprintf("%s%s", c.GatewayURL, cid)
}

// FetchContent retrieves content from IPFS by CID
func (c *IPFSClient) FetchContent(cid string) (string, error) {
	url := c.GetGatewayURL(cid)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return "", fmt.Errorf("failed to fetch from IPFS: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("IPFS gateway returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	return string(body), nil
}
