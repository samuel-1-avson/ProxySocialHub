// Package proxyhubb provides a Go client for the ProxyHub Bulk Proxy Pool API.
package proxyhubb

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

const defaultBaseURL = "https://api.proxyhubb.io"

// Endpoint represents a single proxy endpoint returned by the API.
type Endpoint struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	SessionType string `json:"session_type"`
}

// Pool represents a proxy pool returned by the API.
type Pool struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
	Size   int    `json:"size"`
}

// Client is an HTTP client for the ProxyHub API.
type Client struct {
	APIKey     string
	BaseURL    string
	HTTPClient *http.Client
}

// NewClient creates a new ProxyHub API client using the given API key.
// It uses the production base URL by default.
func NewClient(apiKey string) *Client {
	return &Client{
		APIKey:     apiKey,
		BaseURL:    defaultBaseURL,
		HTTPClient: &http.Client{},
	}
}

// do executes an HTTP request, attaching the X-API-Key header.
func (c *Client) do(ctx context.Context, method, path string, body interface{}, out interface{}) error {
	url := c.BaseURL + path

	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request: %w", err)
		}
		reqBody = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}

	req.Header.Set("X-API-Key", c.APIKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("http do: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNoContent {
		return nil
	}

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}

	if resp.StatusCode >= 400 {
		// Try to extract error message from JSON body
		var errPayload struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(respBytes, &errPayload)
		msg := errPayload.Error
		if msg == "" {
			msg = resp.Status
		}
		return fmt.Errorf("API error %d: %s", resp.StatusCode, msg)
	}

	if out != nil {
		if err := json.Unmarshal(respBytes, out); err != nil {
			return fmt.Errorf("unmarshal response: %w", err)
		}
	}

	return nil
}

// CreatePool creates a new proxy pool with the specified name and size.
func (c *Client) CreatePool(ctx context.Context, name string, size int) (*Pool, error) {
	payload := map[string]interface{}{
		"name": name,
		"size": size,
	}

	var pool Pool
	if err := c.do(ctx, http.MethodPost, "/v1/bulk/pools", payload, &pool); err != nil {
		return nil, err
	}

	return &pool, nil
}

// GetProxies returns the list of endpoints for the given pool.
func (c *Client) GetProxies(ctx context.Context, poolID string) ([]Endpoint, error) {
	var result struct {
		Endpoints []Endpoint `json:"endpoints"`
	}

	path := fmt.Sprintf("/v1/bulk/pools/%s/endpoints", poolID)
	if err := c.do(ctx, http.MethodGet, path, nil, &result); err != nil {
		return nil, err
	}

	return result.Endpoints, nil
}
