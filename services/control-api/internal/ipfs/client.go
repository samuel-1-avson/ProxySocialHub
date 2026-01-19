package ipfs

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"
)

// IPFSClient handles interactions with IPFS (Mocked for MVP)
type IPFSClient struct {
	GatewayURL string
}

func NewClient() *IPFSClient {
	return &IPFSClient{
		GatewayURL: "https://ipfs.io/ipfs/",
	}
}

// UploadText simulates uploading text to IPFS and returns a CID (Hash)
func (c *IPFSClient) UploadText(content string) (string, error) {
	// In a real implementation, this would POST to Infura/Pinata
	// For MVP, we generate a deterministic hash of the content
	// simulating a CID.

	hash := sha256.Sum256([]byte(content + time.Now().String()))  // Add entropy
	cid := fmt.Sprintf("Qm%s", hex.EncodeToString(hash[:]))[0:46] // Simulate Qm... style CID

	return cid, nil
}

// GetGatewayURL returns the public URL for a given CID
func (c *IPFSClient) GetGatewayURL(cid string) string {
	return fmt.Sprintf("%s%s", c.GatewayURL, cid)
}
