package bittensor

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/proxyhubb/control-api/internal/config"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
}

type NetworkStatus struct {
	Network       string `json:"network"`
	ChainEndpoint string `json:"chain_endpoint"`
	CurrentBlock  int    `json:"current_block"`
	IsConnected   bool   `json:"is_connected"`
}

type RegisterProxyRequest struct {
	IP           string `json:"ip"`
	Port         int    `json:"port"`
	NetUID       int    `json:"net_uid"`
	WalletName   string `json:"wallet_name,omitempty"`
	WalletHotkey string `json:"wallet_hotkey,omitempty"`
}

type RegisterProxyResponse struct {
	Status  string          `json:"status"`
	Data    json.RawMessage `json:"data"`
	Message string          `json:"message"`
}

func NewClient(cfg config.BittensorConfig) *Client {
	return &Client{
		baseURL: cfg.BridgeURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (c *Client) GetNetworkStatus() (*NetworkStatus, error) {
	resp, err := c.httpClient.Get(fmt.Sprintf("%s/network/status", c.baseURL))
	if err != nil {
		return nil, fmt.Errorf("failed to get network status: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var status NetworkStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &status, nil
}

func (c *Client) RegisterProxy(req RegisterProxyRequest) (*RegisterProxyResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	resp, err := c.httpClient.Post(fmt.Sprintf("%s/proxy/register", c.baseURL), "application/json", bytes.NewBuffer(body))
	if err != nil {
		return nil, fmt.Errorf("failed to register proxy: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var response RegisterProxyResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &response, nil
}

type WalletInfo struct {
	Name   string `json:"name"`
	Hotkey string `json:"hotkey"`
}

type WalletResponse struct {
	Status      string `json:"status,omitempty"`
	ColdkeySS58 string `json:"coldkey_ss58"`
	HotkeySS58  string `json:"hotkey_ss58"`
	Path        string `json:"path,omitempty"`
	Balance     string `json:"balance,omitempty"`
}

func (c *Client) CreateDevWallet(name, hotkey string) (*WalletResponse, error) {
	req := WalletInfo{Name: name, Hotkey: hotkey}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	resp, err := c.httpClient.Post(fmt.Sprintf("%s/wallet/create-dev", c.baseURL), "application/json", bytes.NewBuffer(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create wallet: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var response WalletResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &response, nil
}

func (c *Client) GetWallet(name, hotkey string) (*WalletResponse, error) {
	url := fmt.Sprintf("%s/wallet?name=%s&hotkey=%s", c.baseURL, name, hotkey)
	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to get wallet: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var response WalletResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &response, nil
}

type VerifySignatureRequest struct {
	SS58Address string `json:"ss58_address"`
	Data        string `json:"data"`
	Signature   string `json:"signature"`
}

type VerifySignatureResponse struct {
	IsValid bool   `json:"is_valid"`
	Error   string `json:"error,omitempty"`
}

func (c *Client) VerifySignature(address, data, signature string) (bool, error) {
	req := VerifySignatureRequest{
		SS58Address: address,
		Data:        data,
		Signature:   signature,
	}
	body, err := json.Marshal(req)
	if err != nil {
		return false, fmt.Errorf("failed to marshal request: %w", err)
	}

	resp, err := c.httpClient.Post(fmt.Sprintf("%s/auth/verify", c.baseURL), "application/json", bytes.NewBuffer(body))
	if err != nil {
		return false, fmt.Errorf("failed to verify signature: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var response VerifySignatureResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return false, fmt.Errorf("failed to decode response: %w", err)
	}

	if response.Error != "" {
		return false, fmt.Errorf("verification error from bridge: %s", response.Error)
	}

	return response.IsValid, nil
}

type TransferRequest struct {
	WalletName   string  `json:"wallet_name"`
	WalletHotkey string  `json:"wallet_hotkey"`
	Destination  string  `json:"destination"`
	Amount       float64 `json:"amount"`
}

type TransferResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

func (c *Client) TransferTAO(walletName, hotkey, dest string, amount float64) error {
	req := TransferRequest{
		WalletName:   walletName,
		WalletHotkey: hotkey,
		Destination:  dest,
		Amount:       amount,
	}
	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	resp, err := c.httpClient.Post(fmt.Sprintf("%s/wallet/transfer", c.baseURL), "application/json", bytes.NewBuffer(body))
	if err != nil {
		return fmt.Errorf("failed to send transfer request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var response TransferResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}

	if response.Status != "success" {
		return fmt.Errorf("transfer failed: %s", response.Message)
	}

	return nil
}

type ValidatorScoresResponse struct {
	NetUID int                `json:"netuid"`
	Scores map[string]float64 `json:"scores"`
}

func (c *Client) GetValidatorScores(netuid int) (*ValidatorScoresResponse, error) {
	resp, err := c.httpClient.Get(fmt.Sprintf("%s/validators/scores?netuid=%d", c.baseURL, netuid))
	if err != nil {
		return nil, fmt.Errorf("failed to get scores: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var response ValidatorScoresResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &response, nil
}

// SetWeightsRequest represents weights to broadcast to Subtensor
type SetWeightsRequest struct {
	WalletName   string    `json:"wallet_name"`
	WalletHotkey string    `json:"wallet_hotkey"`
	NetUID       int       `json:"net_uid"`
	UIDs         []int     `json:"uids"`    // Miner UIDs
	Weights      []float64 `json:"weights"` // Corresponding weights (0-1)
}

type SetWeightsResponse struct {
	Status      string `json:"status"`
	TxHash      string `json:"tx_hash,omitempty"`
	BlockNumber int    `json:"block_number,omitempty"`
	Message     string `json:"message,omitempty"`
}

// SetWeights broadcasts validator weights to the Subtensor chain
func (c *Client) SetWeights(req SetWeightsRequest) (*SetWeightsResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	resp, err := c.httpClient.Post(fmt.Sprintf("%s/validators/set-weights", c.baseURL), "application/json", bytes.NewBuffer(body))
	if err != nil {
		return nil, fmt.Errorf("failed to set weights: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var response SetWeightsResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if response.Status != "success" {
		return nil, fmt.Errorf("set weights failed: %s", response.Message)
	}

	return &response, nil
}

// ChainEvent represents an event from the blockchain
type ChainEvent struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
	Block   int64           `json:"block"`
}

// EventsResponse wraps the events list from the bridge
type EventsResponse struct {
	Events      []ChainEvent `json:"events"`
	LatestBlock int64        `json:"latest_block"`
}

// GetEvents fetches chain events from the bridge starting from a specific block
func (c *Client) GetEvents(fromBlock int64) ([]ChainEvent, int64, error) {
	url := fmt.Sprintf("%s/events?from_block=%d", c.baseURL, fromBlock)
	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to fetch events: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var response EventsResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, 0, fmt.Errorf("failed to decode response: %w", err)
	}

	return response.Events, response.LatestBlock, nil
}
