package sdk

import (
	"crypto/ed25519"
	"encoding/hex"
	"fmt"
)

type L2Update struct {
	ChannelID string `json:"channel_id"`
	Nonce     uint64 `json:"nonce"`
	Amount    uint64 `json:"amount"` // Atomic units
	BytesUsed int64  `json:"bytes_used"`
	Signature string `json:"signature"`
}

// SignStateUpdate generates an Ed25519 signature for a state channel update
func (c *Client) SignStateUpdate(privKey ed25519.PrivateKey, channelID string, nonce uint64, amount uint64, bytesUsed int64) (string, error) {
	// Canonical message format: "channelID:nonce:amount:bytesUsed"
	msg := fmt.Sprintf("%s:%d:%d:%d", channelID, nonce, amount, bytesUsed)

	sig := ed25519.Sign(privKey, []byte(msg))
	return hex.EncodeToString(sig), nil
}

// SubmitL2Update transmits a signed state update to the L2 gateway
func (c *Client) SubmitL2Update(update L2Update) error {
	return c.Request("POST", "/v1/channels/update", update, nil)
}

// HeartbeatLoop (Optional/Advanced) - Could be implemented here to auto-sign/send
