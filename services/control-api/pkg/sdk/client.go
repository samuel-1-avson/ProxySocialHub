package sdk

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Client is the main entry point for the ProxyHub Enterprise Go SDK
type Client struct {
	BaseURL    string
	AuthToken  string
	HTTPClient *http.Client
}

// Config provides initialization settings for the SDK client
type Config struct {
	BaseURL   string
	AuthToken string
	Timeout   time.Duration
}

// NewClient creates a new ProxyHub SDK client
func NewClient(cfg Config) *Client {
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Second
	}
	return &Client{
		BaseURL:   cfg.BaseURL,
		AuthToken: cfg.AuthToken,
		HTTPClient: &http.Client{
			Timeout: cfg.Timeout,
		},
	}
}

// Request executes a signed/authenticated request to the ProxyHub API
func (c *Client) Request(method, path string, body interface{}, result interface{}) error {
	url := fmt.Sprintf("%s%s", c.BaseURL, path)

	var bodyReader *bytes.Reader
	if body != nil {
		jsonBody, _ := json.Marshal(body)
		bodyReader = bytes.NewReader(jsonBody)
	} else {
		bodyReader = bytes.NewReader([]byte{})
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	if c.AuthToken != "" {
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.AuthToken))
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("network error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("api error (status %d)", resp.StatusCode)
	}

	if result != nil {
		return json.NewDecoder(resp.Body).Decode(result)
	}

	return nil
}
