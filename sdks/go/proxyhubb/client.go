// Package proxyhubb provides a Go client for the ProxyHubb Control API
// (buyer Connect/bulk pools and seller/provider APIs).
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
	"strconv"
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
	Username        string `json:"username"`
	Password        string `json:"password"`
	LegacyPassword  string `json:"legacy_password,omitempty"`
	AuthForEndpoint string `json:"auth_for_endpoint,omitempty"`
	Host            string `json:"host"`
	Port            int    `json:"port"`
	Protocol        string `json:"protocol"`
	Endpoint        string `json:"endpoint"`
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

// CreateProviderTokenRequest is POST /v1/provider/tokens.
type CreateProviderTokenRequest struct {
	Name      string `json:"name,omitempty"`
	ExpiresIn int    `json:"expires_in,omitempty"`
	NodeID    string `json:"node_id,omitempty"`
}

// CreateProviderNodeRequest is POST /v1/provider/nodes.
type CreateProviderNodeRequest struct {
	Name           string `json:"name"`
	IPAddress      string `json:"ip_address,omitempty"`
	Country        string `json:"country,omitempty"`
	City           string `json:"city,omitempty"`
	ConnectionType string `json:"connection_type,omitempty"`
}

// Client is an HTTP client for the ProxyHubb API.
type Client struct {
	APIKey        string
	AccessToken   string // Dashboard JWT or provider token (Bearer)
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
// (required for session intents, order credentials, and seller/provider ops).
func NewClientWithToken(accessToken string) *Client {
	return &Client{
		AccessToken:   accessToken,
		BaseURL:       DefaultBaseURL,
		ProxyEndpoint: DefaultProxyEndpointFromEnv(),
		HTTPClient:    &http.Client{},
	}
}

// NewClientWithProviderToken is an alias of NewClientWithToken — provider
// tokens use the same Authorization Bearer header as dashboard JWTs.
func NewClientWithProviderToken(providerToken string) *Client {
	return NewClientWithToken(providerToken)
}

// SetProviderToken sets the Bearer credential (JWT or provider token).
func (c *Client) SetProviderToken(token string) {
	c.AccessToken = token
}

// do executes an HTTP request, attaching auth headers.
func (c *Client) do(ctx context.Context, method, path string, body interface{}, out interface{}) error {
	fullURL := c.BaseURL + path

	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request: %w", err)
		}
		reqBody = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, fullURL, reqBody)
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

func pageQuery(page, limit int) string {
	q := url.Values{}
	if page > 0 {
		q.Set("page", strconv.Itoa(page))
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	encoded := q.Encode()
	if encoded == "" {
		return ""
	}
	return "?" + encoded
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

// ListProviderTokens returns masked provider tokens.
func (c *Client) ListProviderTokens(ctx context.Context) (map[string]interface{}, error) {
	var out map[string]interface{}
	if err := c.do(ctx, http.MethodGet, "/v1/provider/tokens", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// CreateProviderToken creates a token; plaintext "token" is returned once.
func (c *Client) CreateProviderToken(ctx context.Context, req CreateProviderTokenRequest) (map[string]interface{}, error) {
	var out map[string]interface{}
	if err := c.do(ctx, http.MethodPost, "/v1/provider/tokens", req, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// RotateProviderToken rotates a token; new plaintext "token" is returned once.
func (c *Client) RotateProviderToken(ctx context.Context, tokenID string) (map[string]interface{}, error) {
	if tokenID == "" {
		return nil, fmt.Errorf("tokenID is required")
	}
	var out map[string]interface{}
	path := fmt.Sprintf("/v1/provider/tokens/%s/rotate", tokenID)
	if err := c.do(ctx, http.MethodPost, path, map[string]interface{}{}, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// RevokeProviderToken revokes a provider token.
func (c *Client) RevokeProviderToken(ctx context.Context, tokenID string) error {
	if tokenID == "" {
		return fmt.Errorf("tokenID is required")
	}
	path := fmt.Sprintf("/v1/provider/tokens/%s", tokenID)
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

// GetProviderReadiness returns onboarding readiness checks.
func (c *Client) GetProviderReadiness(ctx context.Context) (map[string]interface{}, error) {
	var out map[string]interface{}
	if err := c.do(ctx, http.MethodGet, "/v1/provider/readiness", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ListProviderNodes lists nodes for the authenticated provider.
func (c *Client) ListProviderNodes(ctx context.Context) (map[string]interface{}, error) {
	var out map[string]interface{}
	if err := c.do(ctx, http.MethodGet, "/v1/provider/nodes", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// CreateProviderNode registers a new provider node.
func (c *Client) CreateProviderNode(ctx context.Context, req CreateProviderNodeRequest) (map[string]interface{}, error) {
	if req.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	var out map[string]interface{}
	if err := c.do(ctx, http.MethodPost, "/v1/provider/nodes", req, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// UpdateProviderNode updates a provider node.
func (c *Client) UpdateProviderNode(ctx context.Context, nodeID string, req CreateProviderNodeRequest) (map[string]interface{}, error) {
	if nodeID == "" {
		return nil, fmt.Errorf("nodeID is required")
	}
	var out map[string]interface{}
	path := fmt.Sprintf("/v1/provider/nodes/%s", nodeID)
	if err := c.do(ctx, http.MethodPut, path, req, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// DeleteProviderNode deletes a provider node.
func (c *Client) DeleteProviderNode(ctx context.Context, nodeID string) error {
	if nodeID == "" {
		return fmt.Errorf("nodeID is required")
	}
	path := fmt.Sprintf("/v1/provider/nodes/%s", nodeID)
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

// GetNodeConnect returns join/start hints for provider-cli / provider-node.
func (c *Client) GetNodeConnect(ctx context.Context, nodeID string) (map[string]interface{}, error) {
	if nodeID == "" {
		return nil, fmt.Errorf("nodeID is required")
	}
	var out map[string]interface{}
	path := fmt.Sprintf("/v1/provider/nodes/%s/connect", nodeID)
	if err := c.do(ctx, http.MethodGet, path, nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ListMyListings returns the authenticated seller's listings.
func (c *Client) ListMyListings(ctx context.Context, page, limit int) (map[string]interface{}, error) {
	var out map[string]interface{}
	path := "/v1/listings/my" + pageQuery(page, limit)
	if err := c.do(ctx, http.MethodGet, path, nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetListing returns a listing by ID.
func (c *Client) GetListing(ctx context.Context, listingID string) (map[string]interface{}, error) {
	if listingID == "" {
		return nil, fmt.Errorf("listingID is required")
	}
	var out map[string]interface{}
	path := fmt.Sprintf("/v1/listings/%s", listingID)
	if err := c.do(ctx, http.MethodGet, path, nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// CreateListing creates a marketplace listing as seller.
func (c *Client) CreateListing(ctx context.Context, fields map[string]interface{}) (map[string]interface{}, error) {
	var out map[string]interface{}
	if err := c.do(ctx, http.MethodPost, "/v1/listings", fields, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// UpdateListing updates a listing. Pause/activate with status "active"|"paused".
func (c *Client) UpdateListing(ctx context.Context, listingID string, fields map[string]interface{}) (map[string]interface{}, error) {
	if listingID == "" {
		return nil, fmt.Errorf("listingID is required")
	}
	var out map[string]interface{}
	path := fmt.Sprintf("/v1/listings/%s", listingID)
	if err := c.do(ctx, http.MethodPatch, path, fields, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// DeleteListing deletes a listing.
func (c *Client) DeleteListing(ctx context.Context, listingID string) error {
	if listingID == "" {
		return fmt.Errorf("listingID is required")
	}
	path := fmt.Sprintf("/v1/listings/%s", listingID)
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

// GetEarningsSummary returns provider earnings summary.
func (c *Client) GetEarningsSummary(ctx context.Context) (map[string]interface{}, error) {
	var out map[string]interface{}
	if err := c.do(ctx, http.MethodGet, "/v1/provider/earnings/summary", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ListEarnings returns paginated earnings rows.
func (c *Client) ListEarnings(ctx context.Context, page, limit int) (map[string]interface{}, error) {
	var out map[string]interface{}
	path := "/v1/provider/earnings" + pageQuery(page, limit)
	if err := c.do(ctx, http.MethodGet, path, nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ListEarningsHistory returns paid payout history.
func (c *Client) ListEarningsHistory(ctx context.Context) (map[string]interface{}, error) {
	var out map[string]interface{}
	if err := c.do(ctx, http.MethodGet, "/v1/provider/earnings/history", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ── DePIN & P2P Direct Mesh (Wave 5+) ───────────────────────────────────

// P2PSignalOfferRequest holds parameters for registering a buyer WebRTC / QUIC connection offer.
type P2PSignalOfferRequest struct {
	SessionID      string   `json:"session_id"`
	BuyerPubkey    string   `json:"buyer_pubkey"`
	ProviderHotkey string   `json:"provider_hotkey"`
	OfferSDP       string   `json:"offer_sdp"`
	ICECandidates  []string `json:"ice_candidates,omitempty"`
}

// P2PSignalAnswerRequest holds parameters for registering a provider WebRTC / QUIC connection answer.
type P2PSignalAnswerRequest struct {
	SessionID      string   `json:"session_id"`
	ProviderHotkey string   `json:"provider_hotkey"`
	AnswerSDP      string   `json:"answer_sdp"`
	ICECandidates  []string `json:"ice_candidates,omitempty"`
}

// CreateP2PSignalOffer registers a buyer WebRTC / QUIC connection offer.
func (c *Client) CreateP2PSignalOffer(ctx context.Context, req P2PSignalOfferRequest) (map[string]interface{}, error) {
	var out map[string]interface{}
	if err := c.do(ctx, http.MethodPost, "/v1/p2p/signal/offer", req, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// CreateP2PSignalAnswer registers a provider WebRTC / QUIC connection answer.
func (c *Client) CreateP2PSignalAnswer(ctx context.Context, req P2PSignalAnswerRequest) (map[string]interface{}, error) {
	var out map[string]interface{}
	if err := c.do(ctx, http.MethodPost, "/v1/p2p/signal/answer", req, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetP2PSignals gets active P2P connection coordinates for a session.
func (c *Client) GetP2PSignals(ctx context.Context, sessionID string) (map[string]interface{}, error) {
	if sessionID == "" {
		return nil, fmt.Errorf("sessionID is required")
	}
	var out map[string]interface{}
	path := fmt.Sprintf("/v1/p2p/signal/%s", sessionID)
	if err := c.do(ctx, http.MethodGet, path, nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetGatewayOperators lists bonded & manifest-verified Gateway Operators.
func (c *Client) GetGatewayOperators(ctx context.Context) (map[string]interface{}, error) {
	var out map[string]interface{}
	if err := c.do(ctx, http.MethodGet, "/v1/gateways/operators", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetDePINMiningStats gets DePIN network metrics and Proof-of-Bandwidth mining epoch telemetry.
func (c *Client) GetDePINMiningStats(ctx context.Context) (map[string]interface{}, error) {
	var out map[string]interface{}
	if err := c.do(ctx, http.MethodGet, "/v1/network", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}
