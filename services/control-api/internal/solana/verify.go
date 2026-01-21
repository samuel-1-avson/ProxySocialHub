package solana

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
)

// RPC Endpoint (default to devnet, override with env)
var rpcEndpoint = getEnvOrDefault("SOLANA_RPC_ENDPOINT", "https://api.devnet.solana.com")

func getEnvOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

// TransactionResult represents the structure of a Solana transaction
type TransactionResult struct {
	Slot        uint64   `json:"slot"`
	BlockTime   *int64   `json:"blockTime"`
	Meta        *TxMeta  `json:"meta"`
	Transaction TxDetail `json:"transaction"`
}

type TxMeta struct {
	Err               interface{} `json:"err"`
	Fee               uint64      `json:"fee"`
	PreBalances       []uint64    `json:"preBalances"`
	PostBalances      []uint64    `json:"postBalances"`
	InnerInstructions []struct{}  `json:"innerInstructions"`
	LogMessages       []string    `json:"logMessages"`
}

type TxDetail struct {
	Message    TxMessage `json:"message"`
	Signatures []string  `json:"signatures"`
}

type TxMessage struct {
	AccountKeys []string `json:"accountKeys"`
}

type rpcRequest struct {
	Jsonrpc string        `json:"jsonrpc"`
	ID      int           `json:"id"`
	Method  string        `json:"method"`
	Params  []interface{} `json:"params"`
}

type rpcResponse struct {
	Jsonrpc string          `json:"jsonrpc"`
	Result  json.RawMessage `json:"result"`
	Error   *rpcError       `json:"error"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// VerifyTransaction verifies a Solana transaction exists and was successful
func VerifyTransaction(ctx context.Context, txHash string) (*TransactionResult, error) {
	client := &http.Client{Timeout: 30 * time.Second}

	reqBody := rpcRequest{
		Jsonrpc: "2.0",
		ID:      1,
		Method:  "getTransaction",
		Params: []interface{}{
			txHash,
			map[string]interface{}{
				"encoding":                       "json",
				"commitment":                     "confirmed",
				"maxSupportedTransactionVersion": 0,
			},
		},
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", rpcEndpoint, bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("RPC request failed: %w", err)
	}
	defer resp.Body.Close()

	var rpcResp rpcResponse
	if err := json.NewDecoder(resp.Body).Decode(&rpcResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if rpcResp.Error != nil {
		return nil, fmt.Errorf("RPC error: %s", rpcResp.Error.Message)
	}

	// Check if transaction exists
	if string(rpcResp.Result) == "null" {
		return nil, errors.New("transaction not found")
	}

	var txResult TransactionResult
	if err := json.Unmarshal(rpcResp.Result, &txResult); err != nil {
		return nil, fmt.Errorf("failed to parse transaction: %w", err)
	}

	// Check if transaction failed
	if txResult.Meta != nil && txResult.Meta.Err != nil {
		return nil, fmt.Errorf("transaction failed on-chain: %v", txResult.Meta.Err)
	}

	logging.Info().
		Str("tx_hash", txHash).
		Uint64("slot", txResult.Slot).
		Msg("Solana transaction verified")

	return &txResult, nil
}

// VerifyTransferAmount verifies the transfer amount to a specific recipient
func VerifyTransferAmount(tx *TransactionResult, recipient string, expectedLamports uint64) (bool, float64, error) {
	if tx.Meta == nil {
		return false, 0, errors.New("transaction has no metadata")
	}

	// Find recipient in account keys
	recipientIndex := -1
	for i, acc := range tx.Transaction.Message.AccountKeys {
		if acc == recipient {
			recipientIndex = i
			break
		}
	}

	if recipientIndex == -1 {
		return false, 0, errors.New("recipient not found in transaction")
	}

	// Calculate amount received by recipient
	preBalance := tx.Meta.PreBalances[recipientIndex]
	postBalance := tx.Meta.PostBalances[recipientIndex]

	if postBalance <= preBalance {
		return false, 0, errors.New("no tokens received by recipient")
	}

	receivedLamports := postBalance - preBalance
	receivedSOL := float64(receivedLamports) / 1e9 // Convert lamports to SOL

	// Check if amount matches (with small tolerance for rounding)
	if expectedLamports > 0 && receivedLamports < expectedLamports {
		return false, receivedSOL, fmt.Errorf("received %.9f SOL, expected %.9f SOL", receivedSOL, float64(expectedLamports)/1e9)
	}

	return true, receivedSOL, nil
}

// GetTreasuryAddress returns the platform treasury address
func GetTreasuryAddress() string {
	return os.Getenv("SOLANA_TREASURY_ADDRESS")
}
