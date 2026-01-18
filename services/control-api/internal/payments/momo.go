package payments

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"
)

// MoMoProvider represents different mobile money providers in Ghana
type MoMoProvider string

const (
	ProviderMTN        MoMoProvider = "mtn"
	ProviderVodafone   MoMoProvider = "vodafone"
	ProviderAirtelTigo MoMoProvider = "airteltigo"
)

// MoMoConfig holds configuration for MoMo API
type MoMoConfig struct {
	Provider        MoMoProvider
	BaseURL         string
	SubscriptionKey string
	APIUser         string
	APIKey          string
	Environment     string // "sandbox" or "production"
	CallbackURL     string
}

// MoMoClient handles MoMo API interactions
type MoMoClient struct {
	config     MoMoConfig
	httpClient *http.Client
}

// PaymentRequest represents a collection request
type PaymentRequest struct {
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
	Phone       string  `json:"phone"`
	Reference   string  `json:"reference"`
	Description string  `json:"description"`
}

// PaymentResponse from MoMo API
type PaymentResponse struct {
	TransactionID string `json:"transaction_id"`
	Status        string `json:"status"` // "pending", "successful", "failed"
	Message       string `json:"message"`
}

// DisbursementRequest represents a payout request
type DisbursementRequest struct {
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
	Phone       string  `json:"phone"`
	Reference   string  `json:"reference"`
	Description string  `json:"description"`
}

// NewMoMoClient creates a new MoMo API client
func NewMoMoClient(provider MoMoProvider) (*MoMoClient, error) {
	var config MoMoConfig

	switch provider {
	case ProviderMTN:
		config = MoMoConfig{
			Provider:        ProviderMTN,
			BaseURL:         os.Getenv("MTN_MOMO_BASE_URL"),
			SubscriptionKey: os.Getenv("MTN_MOMO_SUBSCRIPTION_KEY"),
			APIUser:         os.Getenv("MTN_MOMO_API_USER"),
			APIKey:          os.Getenv("MTN_MOMO_API_KEY"),
			Environment:     os.Getenv("MTN_MOMO_ENVIRONMENT"),
			CallbackURL:     os.Getenv("MOMO_CALLBACK_URL"),
		}
		if config.BaseURL == "" {
			config.BaseURL = "https://sandbox.momodeveloper.mtn.com"
		}
	case ProviderVodafone:
		config = MoMoConfig{
			Provider:        ProviderVodafone,
			BaseURL:         os.Getenv("VODAFONE_BASE_URL"),
			SubscriptionKey: os.Getenv("VODAFONE_API_KEY"),
			Environment:     os.Getenv("VODAFONE_ENVIRONMENT"),
			CallbackURL:     os.Getenv("MOMO_CALLBACK_URL"),
		}
	case ProviderAirtelTigo:
		config = MoMoConfig{
			Provider:        ProviderAirtelTigo,
			BaseURL:         os.Getenv("AIRTELTIGO_BASE_URL"),
			SubscriptionKey: os.Getenv("AIRTELTIGO_API_KEY"),
			Environment:     os.Getenv("AIRTELTIGO_ENVIRONMENT"),
			CallbackURL:     os.Getenv("MOMO_CALLBACK_URL"),
		}
	default:
		return nil, fmt.Errorf("unsupported provider: %s", provider)
	}

	if config.Environment == "" {
		config.Environment = "sandbox"
	}

	return &MoMoClient{
		config: config,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}, nil
}

// RequestPayment initiates a collection (deposit) from user
func (c *MoMoClient) RequestPayment(req PaymentRequest) (*PaymentResponse, error) {
	switch c.config.Provider {
	case ProviderMTN:
		return c.mtnCollection(req)
	case ProviderVodafone:
		return c.vodafoneCollection(req)
	case ProviderAirtelTigo:
		return c.airtelTigoCollection(req)
	default:
		return nil, fmt.Errorf("unsupported provider")
	}
}

// Disburse initiates a disbursement (withdrawal/payout) to user
func (c *MoMoClient) Disburse(req DisbursementRequest) (*PaymentResponse, error) {
	switch c.config.Provider {
	case ProviderMTN:
		return c.mtnDisbursement(req)
	case ProviderVodafone:
		return c.vodafoneDisbursement(req)
	case ProviderAirtelTigo:
		return c.airtelTigoDisbursement(req)
	default:
		return nil, fmt.Errorf("unsupported provider")
	}
}

// MTN MoMo Collection API
func (c *MoMoClient) mtnCollection(req PaymentRequest) (*PaymentResponse, error) {
	url := fmt.Sprintf("%s/collection/v1_0/requesttopay", c.config.BaseURL)

	payload := map[string]interface{}{
		"amount":     fmt.Sprintf("%.2f", req.Amount),
		"currency":   req.Currency,
		"externalId": req.Reference,
		"payer": map[string]string{
			"partyIdType": "MSISDN",
			"partyId":     req.Phone,
		},
		"payerMessage": req.Description,
		"payeeNote":    "ProxyHub deposit",
	}

	body, _ := json.Marshal(payload)
	httpReq, _ := http.NewRequest("POST", url, bytes.NewBuffer(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.getAccessToken())
	httpReq.Header.Set("X-Reference-Id", req.Reference)
	httpReq.Header.Set("X-Target-Environment", c.config.Environment)
	httpReq.Header.Set("Ocp-Apim-Subscription-Key", c.config.SubscriptionKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 202 {
		return &PaymentResponse{
			TransactionID: req.Reference,
			Status:        "pending",
			Message:       "Payment request initiated",
		}, nil
	}

	return &PaymentResponse{
		Status:  "failed",
		Message: fmt.Sprintf("Request failed with status: %d", resp.StatusCode),
	}, nil
}

// MTN Disbursement API
func (c *MoMoClient) mtnDisbursement(req DisbursementRequest) (*PaymentResponse, error) {
	url := fmt.Sprintf("%s/disbursement/v1_0/transfer", c.config.BaseURL)

	payload := map[string]interface{}{
		"amount":     fmt.Sprintf("%.2f", req.Amount),
		"currency":   req.Currency,
		"externalId": req.Reference,
		"payee": map[string]string{
			"partyIdType": "MSISDN",
			"partyId":     req.Phone,
		},
		"payerMessage": req.Description,
		"payeeNote":    "ProxyHub payout",
	}

	body, _ := json.Marshal(payload)
	httpReq, _ := http.NewRequest("POST", url, bytes.NewBuffer(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.getAccessToken())
	httpReq.Header.Set("X-Reference-Id", req.Reference)
	httpReq.Header.Set("X-Target-Environment", c.config.Environment)
	httpReq.Header.Set("Ocp-Apim-Subscription-Key", c.config.SubscriptionKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 202 {
		return &PaymentResponse{
			TransactionID: req.Reference,
			Status:        "pending",
			Message:       "Disbursement initiated",
		}, nil
	}

	return &PaymentResponse{
		Status:  "failed",
		Message: fmt.Sprintf("Request failed with status: %d", resp.StatusCode),
	}, nil
}

// Vodafone Cash Collection (stub - implement with actual API)
func (c *MoMoClient) vodafoneCollection(req PaymentRequest) (*PaymentResponse, error) {
	// TODO: Implement Vodafone Cash API integration
	return &PaymentResponse{
		TransactionID: req.Reference,
		Status:        "pending",
		Message:       "Vodafone Cash integration pending",
	}, nil
}

func (c *MoMoClient) vodafoneDisbursement(req DisbursementRequest) (*PaymentResponse, error) {
	// TODO: Implement Vodafone Cash disbursement
	return &PaymentResponse{
		TransactionID: req.Reference,
		Status:        "pending",
		Message:       "Vodafone Cash disbursement pending",
	}, nil
}

// AirtelTigo Money Collection (stub - implement with actual API)
func (c *MoMoClient) airtelTigoCollection(req PaymentRequest) (*PaymentResponse, error) {
	// TODO: Implement AirtelTigo Money API integration
	return &PaymentResponse{
		TransactionID: req.Reference,
		Status:        "pending",
		Message:       "AirtelTigo Money integration pending",
	}, nil
}

func (c *MoMoClient) airtelTigoDisbursement(req DisbursementRequest) (*PaymentResponse, error) {
	// TODO: Implement AirtelTigo Money disbursement
	return &PaymentResponse{
		TransactionID: req.Reference,
		Status:        "pending",
		Message:       "AirtelTigo Money disbursement pending",
	}, nil
}

// Token cache
var tokenCache = struct {
	sync.RWMutex
	tokens  map[MoMoProvider]string
	expires map[MoMoProvider]time.Time
}{
	tokens:  make(map[MoMoProvider]string),
	expires: make(map[MoMoProvider]time.Time),
}

// getAccessToken retrieves OAuth access token for MTN MoMo
func (c *MoMoClient) getAccessToken() string {
	// Check cache
	tokenCache.RLock()
	token, ok := tokenCache.tokens[c.config.Provider]
	expires, expOk := tokenCache.expires[c.config.Provider]
	tokenCache.RUnlock()

	if ok && expOk && time.Now().Before(expires) {
		return token
	}

	// Lock for update
	tokenCache.Lock()
	defer tokenCache.Unlock()

	// Double check
	if token, ok = tokenCache.tokens[c.config.Provider]; ok {
		if expires, ok = tokenCache.expires[c.config.Provider]; ok && time.Now().Before(expires) {
			return token
		}
	}

	// Request new token
	url := fmt.Sprintf("%s/collection/token/", c.config.BaseURL)
	req, _ := http.NewRequest("POST", url, nil)

	// Basic Auth: APIUser:APIKey
	auth := base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf("%s:%s", c.config.APIUser, c.config.APIKey)))
	req.Header.Set("Authorization", "Basic "+auth)
	req.Header.Set("Ocp-Apim-Subscription-Key", c.config.SubscriptionKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		fmt.Printf("Failed to refresh token: %v\n", err)
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 {
		var result struct {
			AccessToken string `json:"access_token"`
			ExpiresIn   int    `json:"expires_in"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
			tokenCache.tokens[c.config.Provider] = result.AccessToken
			// Expire 5 minutes early to be safe
			tokenCache.expires[c.config.Provider] = time.Now().Add(time.Duration(result.ExpiresIn)*time.Second - 5*time.Minute)
			return result.AccessToken
		}
	}

	return ""
}

// DetectProvider attempts to detect the MoMo provider from phone number
func DetectProvider(phone string) MoMoProvider {
	// Ghana phone number prefixes
	// MTN: 024, 054, 055, 059
	// Vodafone: 020, 050
	// AirtelTigo: 026, 027, 056, 057

	if len(phone) < 3 {
		return ProviderMTN // Default
	}

	// Normalize phone number (remove +233, 233, etc.)
	normalized := phone
	if len(phone) > 10 {
		if phone[:4] == "+233" {
			normalized = "0" + phone[4:]
		} else if phone[:3] == "233" {
			normalized = "0" + phone[3:]
		}
	}

	prefix := ""
	if len(normalized) >= 3 {
		prefix = normalized[:3]
	}

	switch prefix {
	case "024", "054", "055", "059":
		return ProviderMTN
	case "020", "050":
		return ProviderVodafone
	case "026", "027", "056", "057":
		return ProviderAirtelTigo
	default:
		return ProviderMTN
	}
}
