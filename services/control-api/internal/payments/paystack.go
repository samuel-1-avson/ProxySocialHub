package payments

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

const (
	PaystackBaseURL = "https://api.paystack.co"
)

type PaystackClient struct {
	SecretKey string
	Client    *http.Client
}

func NewPaystackClient() *PaystackClient {
	return &PaystackClient{
		SecretKey: os.Getenv("PAYSTACK_SECRET_KEY"),
		Client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// InitializeRequest represents the payload for initializing a transaction
type InitializeRequest struct {
	Email     string                 `json:"email"`
	Amount    string                 `json:"amount"` // In kobo/pesewas (string to avoid float issues)
	Currency  string                 `json:"currency"`
	Reference string                 `json:"reference,omitempty"`
	Callback  string                 `json:"callback_url,omitempty"`
	Channels  []string               `json:"channels,omitempty"` // ["card", "mobile_money"]
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

type InitializeResponse struct {
	Status  bool   `json:"status"`
	Message string `json:"message"`
	Data    struct {
		AuthorizationURL string `json:"authorization_url"`
		AccessCode       string `json:"access_code"`
		Reference        string `json:"reference"`
	} `json:"data"`
}

// InitializeTransaction initializes a payment on Paystack
func (p *PaystackClient) InitializeTransaction(req InitializeRequest) (*InitializeResponse, error) {
	url := fmt.Sprintf("%s/transaction/initialize", PaystackBaseURL)

	jsonData, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	p.setHeaders(httpReq)

	resp, err := p.Client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("paystack error (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	var payload InitializeResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if !payload.Status {
		return nil, fmt.Errorf("paystack returned false status: %s", payload.Message)
	}

	return &payload, nil
}

// VerifyResponse represents the response from verifying a transaction
type VerifyResponse struct {
	Status  bool   `json:"status"`
	Message string `json:"message"`
	Data    struct {
		Status    string `json:"status"` // "success", "failed", "abandoned"
		Reference string `json:"reference"`
		Amount    int64  `json:"amount"` // In minor units
		Gateway   string `json:"gateway_response"`
		Channel   string `json:"channel"`
	} `json:"data"`
}

// VerifyTransaction verifies the status of a transaction
func (p *PaystackClient) VerifyTransaction(reference string) (*VerifyResponse, error) {
	url := fmt.Sprintf("%s/transaction/verify/%s", PaystackBaseURL, reference)

	httpReq, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	p.setHeaders(httpReq)

	resp, err := p.Client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("paystack verification failed with status %d", resp.StatusCode)
	}

	var payload VerifyResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &payload, nil
}

func (p *PaystackClient) setHeaders(req *http.Request) {
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", p.SecretKey))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Cache-Control", "no-cache")
}
