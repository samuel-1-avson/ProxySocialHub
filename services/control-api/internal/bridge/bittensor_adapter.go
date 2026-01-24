package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

type BittensorAdapter struct {
	baseURL      string
	walletName   string
	walletHotkey string
	httpClient   *http.Client
}

func NewBittensorAdapter() *BittensorAdapter {
	baseURL := os.Getenv("BITTENSOR_BRIDGE_URL")
	if baseURL == "" {
		baseURL = "http://bittensor-bridge:8000" // Internal docker DNS
	}

	return &BittensorAdapter{
		baseURL:      baseURL,
		walletName:   os.Getenv("BITTENSOR_WALLET_NAME"), // e.g. "bridge_hotwallet"
		walletHotkey: os.Getenv("BITTENSOR_WALLET_HOTKEY"),
		httpClient:   &http.Client{Timeout: 30 * time.Second},
	}
}

type transferRequest struct {
	WalletName   string  `json:"wallet_name"`
	WalletHotkey string  `json:"wallet_hotkey"`
	Destination  string  `json:"destination"`
	Amount       float64 `json:"amount"`
}

type transferResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
	Data    struct {
		TxHash string `json:"tx_hash"`
	} `json:"data"`
}

// SendTAO sends Tao from the hot wallet to a destination
func (b *BittensorAdapter) SendTAO(ctx context.Context, destination string, amount float64) (string, error) {
	reqBody := transferRequest{
		WalletName:   b.walletName,
		WalletHotkey: b.walletHotkey,
		Destination:  destination,
		Amount:       amount,
	}

	if reqBody.WalletName == "" {
		reqBody.WalletName = "validator" // Default fallback
	}
	if reqBody.WalletHotkey == "" {
		reqBody.WalletHotkey = "default"
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/wallet/transfer", b.baseURL), bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("bittensor bridge request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("bittensor bridge returned status: %d", resp.StatusCode)
	}

	var res transferResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	if res.Status != "success" {
		return "", fmt.Errorf("bittensor transfer failed: %s", res.Message)
	}

	return res.Data.TxHash, nil
}
