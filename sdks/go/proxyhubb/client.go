// Package proxyhubb provides a Go client for the ProxyHubb Control API
// (session intents, order credentials, and bulk pools).
package proxyhubb

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

const (
	DefaultBaseURL       = "https://api.proxyhubb.com"
	DefaultProxyEndpoint = "proxy.proxyhubb.com:8090"
)

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

// ProxyCredentials is returned inside GET /v1/orders/:id/credentials.
type ProxyCredentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Protocol string `json:"protocol"`
	Endpoint string `json:"endpoint"`
}

// SessionIntentResponse is returned by POST /v1/sessions/intent.
type SessionIntentResponse struct {
	Token          string                 `json:"token"`
	ExpiresAt      string                 `json:"expires_at"`
	LifecycleState string                 `json:"lifecycle_state"`
	Intent         map[string]interface{} `json:"intent"`
}

// CreateSessionIntentRequest mirrors the Control API body.
type CreateSessionIntentRequest struct {
	Type                    string   `json:"type"`
	ListingID               string   `json:"listing_id,omitempty"`
	BandwidthLimit          int64    `json:"bandwidth_limit,omitempty"`
	TargetGeo               string   `json:"target_geo,omitempty"`
	TargetISP               string   `json:"target_isp,omitempty"`
	RoutingProfile          string   `json:"routing_profile,omitempty"`
	AllowedDomains          []string `json:"allowed_domains,omitempty"`
	BlockedDomains          []string `json:"blocked_domains,omitempty"`
	RotationType            string   `json:"rotation_type,omitempty"`
	RotationIntervalSeconds int      `json:"rotation_interval_seconds,omitempty"`
	TimeLimitMinutes        int      `json:"time_limit_minutes,omitempty"`
	PreferredTier           string   `json:"preferred_tier,omitempty"`
	MaxPricePerGB           float64  `json:"max_price_per_gb,omitempty"`
}

// Client is an HTTP client for the ProxyHubb API.
type Client struct {
	APIKey        string
	AccessToken   string
	BaseURL       string
	ProxyEndpoint string
	HTTPClient    *http.Client
}

// DefaultProxyEndpointFromEnv returns the buyer CONNECT host:port.
func DefaultProxyEndpointFromEnv() string {
	if v := strings.TrimSpace(os.Getenv("PROXYHUBB_PROXY_ENDPOINT")); v != "" {
		return stripScheme(v)
	}
	return DefaultProxyEndpoint
}

func stripScheme(host string) string {
	host = strings.TrimSpace(host)
	host = strings.TrimPrefix(host, "http://")
	host = strings.TrimPrefix(host, "https://")
	return strings.TrimSuffix(host, "/")
}

// ProxyURL builds an HTTP proxy URL for CONNECT clients.
func ProxyURL(username, password, host string) string {
	if host == "" {
		host = DefaultProxyEndpointFromEnv()
	}
	host = stripScheme(host)
	u := url.UserPassword(username, password)
	return fmt.Sprintf("http://%s@%s", u.String(), host)
}

// SessionIntentProxyURL builds a session-intent proxy URL.
func SessionIntentProxyURL(token, host string) string {
	return ProxyURL("session-intent", token, host)
}

// NewClient creates a new ProxyHubb API client using the given API key.
func NewClient(apiKey string) *Client {
	return &Client{
		APIKey:        apiKey,
		BaseURL:       DefaultBaseURL,
		ProxyEndpoint: DefaultProxyEndpointFromEnv(),
		HTTPClient:    &http.Client{},
	}
}

// NewClientWithToken creates a client authenticated with a dashboard JWT
// (required for session intents and order credentials).
func NewClientWithToken(accessToken string) *Client {
	return &Client{
		AccessToken:   accessToken,
		BaseURL:       DefaultBaseURL,
		ProxyEndpoint: DefaultProxyEndpointFromEnv(),
		HTTPClient:    &http.Client{},
	}
}

// do executes an HTTP request, attaching auth headers.
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

	if c.APIKey != "" {
		req.Header.Set("X-API-Key", c.APIKey)
	}
	if c.AccessToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.AccessToken)
	}
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

// CreateSessionIntent issues a signed session intent (requires AccessToken).
func (c *Client) CreateSessionIntent(ctx context.Context, req CreateSessionIntentRequest) (*SessionIntentResponse, error) {
	if req.Type != "rotating" && req.Type != "sticky" {
		return nil, fmt.Errorf("type must be rotating or sticky")
	}
	var out SessionIntentResponse
	if err := c.do(ctx, http.MethodPost, "/v1/sessions/intent", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SessionIntentProxyURL builds a proxy URL for an intent token using this client's endpoint.
func (c *Client) SessionIntentProxyURL(token string) string {
	host := c.ProxyEndpoint
	if host == "" {
		host = DefaultProxyEndpointFromEnv()
	}
	return SessionIntentProxyURL(token, host)
}

// GetOrderCredentials fetches proxy credentials after escrow activation.
func (c *Client) GetOrderCredentials(ctx context.Context, orderID string) (*ProxyCredentials, error) {
	if orderID == "" {
		return nil, fmt.Errorf("orderID is required")
	}
	var wrap struct {
		ProxyCredentials ProxyCredentials `json:"proxy_credentials"`
	}
	path := fmt.Sprintf("/v1/orders/%s/credentials", orderID)
	if err := c.do(ctx, http.MethodGet, path, nil, &wrap); err != nil {
		return nil, err
	}
	return &wrap.ProxyCredentials, nil
}

// ProxyURLFromCredentials builds a CONNECT proxy URL from credentials.
func (c *Client) ProxyURLFromCredentials(creds *ProxyCredentials) string {
	if creds == nil {
		return ""
	}
	host := creds.Host
	if host == "" {
		host = creds.Endpoint
	}
	if host == "" {
		host = c.ProxyEndpoint
	}
	if creds.Port > 0 && !strings.Contains(host, ":") {
		host = fmt.Sprintf("%s:%d", host, creds.Port)
	}
	return ProxyURL(creds.Username, creds.Password, host)
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

// ListPools returns pools for the authenticated account.
func (c *Client) ListPools(ctx context.Context) ([]Pool, error) {
	var result struct {
		Pools []Pool `json:"pools"`
	}
	if err := c.do(ctx, http.MethodGet, "/v1/bulk/pools", nil, &result); err != nil {
		return nil, err
	}
	return result.Pools, nil
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

// RevokePool soft-deletes a proxy pool.
func (c *Client) RevokePool(ctx context.Context, poolID string) error {
	path := fmt.Sprintf("/v1/bulk/pools/%s", poolID)
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}
