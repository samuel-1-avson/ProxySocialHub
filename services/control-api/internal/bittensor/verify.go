package bittensor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
)

const (
	// Subscan API for Bittensor (Substrate-based)
	subscanAPIMainnet = "https://bittensor.api.subscan.io"
	subscanAPITestnet = "https://bittensor-testnet.api.subscan.io"
)

// TransferInfo represents a TAO transfer extracted from an extrinsic
type TransferInfo struct {
	ExtrinsicHash string  `json:"extrinsic_hash"`
	BlockNumber   int64   `json:"block_number"`
	From          string  `json:"from"`
	To            string  `json:"to"`
	Amount        float64 `json:"amount"`     // TAO (not rao)
	AmountRao     uint64  `json:"amount_rao"` // Raw amount in rao
	Success       bool    `json:"success"`
	Fee           float64 `json:"fee"`
}

// ExtrinsicResponse is the response from Subscan extrinsic API
type ExtrinsicResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		BlockTimestamp int64  `json:"block_timestamp"`
		BlockNumber    int64  `json:"block_num"`
		ExtrinsicHash  string `json:"extrinsic_hash"`
		CallModule     string `json:"call_module"`
		CallModuleFunc string `json:"call_module_function"`
		AccountID      string `json:"account_id"`
		Params         []struct {
			Name     string      `json:"name"`
			Type     string      `json:"type"`
			TypeName string      `json:"type_name"`
			Value    interface{} `json:"value"`
		} `json:"params"`
		Success  bool   `json:"success"`
		Fee      string `json:"fee"`
		Finality bool   `json:"finalized"`
	} `json:"data"`
}

// GetTreasuryAddress returns the platform TAO treasury address
func GetTreasuryAddress() string {
	return db.GetSystemSetting("tao_treasury_address", "TAO_TREASURY_ADDRESS", os.Getenv("BITTENSOR_TREASURY_ADDRESS"))
}

// VerifyTransfer verifies a TAO transfer to the treasury
func VerifyTransfer(ctx context.Context, extrinsicHash string) (*TransferInfo, error) {
	client := &http.Client{Timeout: 30 * time.Second}

	// Use mainnet by default, can be configured via env
	apiBase := subscanAPIMainnet
	if os.Getenv("BITTENSOR_NETWORK") == "testnet" {
		apiBase = subscanAPITestnet
	}

	// Subscan requires POST for extrinsic lookup
	reqBody := map[string]string{"hash": extrinsicHash}
	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", apiBase+"/api/scan/extrinsic", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	// Optional: Add API key if available
	apiKey := os.Getenv("SUBSCAN_API_KEY")
	if apiKey != "" {
		req.Header.Set("X-API-Key", apiKey)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Subscan API request failed: %w", err)
	}
	defer resp.Body.Close()

	var extrinsicResp ExtrinsicResponse
	if err := json.NewDecoder(resp.Body).Decode(&extrinsicResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if extrinsicResp.Code != 0 {
		return nil, fmt.Errorf("Subscan API error: %s", extrinsicResp.Message)
	}

	data := extrinsicResp.Data
	if data.ExtrinsicHash == "" {
		return nil, errors.New("extrinsic not found")
	}

	// Check if it's a balance transfer
	if data.CallModule != "Balances" || (data.CallModuleFunc != "transfer" && data.CallModuleFunc != "transfer_keep_alive" && data.CallModuleFunc != "transfer_allow_death") {
		return nil, fmt.Errorf("not a balance transfer: %s.%s", data.CallModule, data.CallModuleFunc)
	}

	if !data.Success {
		return nil, errors.New("extrinsic failed on-chain")
	}

	// Extract transfer details from params
	var destAddress string
	var amountRao uint64

	for _, param := range data.Params {
		switch param.Name {
		case "dest":
			// Handle different formats
			if destMap, ok := param.Value.(map[string]interface{}); ok {
				if id, ok := destMap["Id"].(string); ok {
					destAddress = id
				}
			} else if destStr, ok := param.Value.(string); ok {
				destAddress = destStr
			}
		case "value":
			// Amount in rao (1 TAO = 1e9 rao)
			if val, ok := param.Value.(float64); ok {
				amountRao = uint64(val)
			} else if val, ok := param.Value.(string); ok {
				fmt.Sscanf(val, "%d", &amountRao)
			}
		}
	}

	if destAddress == "" {
		return nil, errors.New("could not extract destination address from extrinsic")
	}

	amountTAO := float64(amountRao) / 1e9 // Convert rao to TAO

	logging.Info().
		Str("extrinsic_hash", extrinsicHash).
		Str("from", data.AccountID).
		Str("to", destAddress).
		Float64("amount_tao", amountTAO).
		Int64("block", data.BlockNumber).
		Msg("Bittensor extrinsic verified")

	return &TransferInfo{
		ExtrinsicHash: data.ExtrinsicHash,
		BlockNumber:   data.BlockNumber,
		From:          data.AccountID,
		To:            destAddress,
		Amount:        amountTAO,
		AmountRao:     amountRao,
		Success:       data.Success,
	}, nil
}

// VerifyTransferToTreasury verifies a TAO transfer was sent to our treasury
func VerifyTransferToTreasury(ctx context.Context, extrinsicHash string, expectedAmount float64) (*TransferInfo, error) {
	treasury := GetTreasuryAddress()
	if treasury == "" {
		return nil, errors.New("TAO_TREASURY_ADDRESS not configured")
	}

	transfer, err := VerifyTransfer(ctx, extrinsicHash)
	if err != nil {
		return nil, err
	}

	// Check destination matches treasury
	if transfer.To != treasury {
		return nil, fmt.Errorf("transfer destination %s does not match treasury %s", transfer.To, treasury)
	}

	// Optional: Check amount (with tolerance for fees)
	if expectedAmount > 0 && transfer.Amount < expectedAmount*0.99 {
		return nil, fmt.Errorf("received %.4f TAO, expected at least %.4f TAO", transfer.Amount, expectedAmount)
	}

	return transfer, nil
}
