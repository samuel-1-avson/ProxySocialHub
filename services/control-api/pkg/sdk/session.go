package sdk

import (
	"context"
	"fmt"
)

type SessionResponse struct {
	ID             string `json:"id"`
	Status         string `json:"status"`
	BandwidthLimit int64  `json:"bandwidth_limit"`
}

// CreateSession initializes a new proxy session
func (c *Client) CreateSession(ctx context.Context, listingID string, bandwidthLimit int64) (*SessionResponse, error) {
	body := map[string]interface{}{
		"listing_id":      listingID,
		"bandwidth_limit": bandwidthLimit,
	}

	var session SessionResponse
	err := c.Request("POST", "/v1/sessions", body, &session)
	if err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	return &session, nil
}

// CloseSession terminates an active session
func (c *Client) CloseSession(ctx context.Context, sessionID string) error {
	return c.Request("DELETE", fmt.Sprintf("/v1/sessions/%s", sessionID), nil, nil)
}
