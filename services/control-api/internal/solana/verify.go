package solana

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/logging"
)

// RPC Endpoint (default to devnet, override with env)
var rpcEndpoint = PrimaryRPCEndpointFromEnv()

// SetRPCEndpoint overrides the Solana RPC endpoint (mainly for unit tests).
func SetRPCEndpoint(url string) {
	if normalized, err := NormalizeRPCEndpoint(url); err == nil {
		rpcEndpoint = normalized
		return
	}
	rpcEndpoint = url
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

// VerifyTransaction verifies a Solana transaction exists and was successful.
// Retries across SOLANA_RPC_ENDPOINTS when RPC returns null/"not found" or rate limits.
func VerifyTransaction(ctx context.Context, txHash string) (*TransactionResult, error) {
	client := NewRPCHTTPClient()
	endpoints := []string{rpcEndpoint}
	for _, endpoint := range RPCEndpointsFromEnv() {
		if endpoint != "" && endpoint != rpcEndpoint {
			endpoints = append(endpoints, endpoint)
		}
	}
	if len(endpoints) == 0 || strings.TrimSpace(endpoints[0]) == "" {
		endpoints = RPCEndpointsFromEnv()
	}

	commitment := "confirmed"
	if decentralization.DepositRequireFinalized() {
		commitment = "finalized"
	}

	reqBody := rpcRequest{
		Jsonrpc: "2.0",
		ID:      1,
		Method:  "getTransaction",
		Params: []interface{}{
			txHash,
			map[string]interface{}{
				"encoding":                       "json",
				"commitment":                     commitment,
				"maxSupportedTransactionVersion": 0,
			},
		},
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	const (
		maxAttempts = 12
		retryDelay  = 1500 * time.Millisecond
	)

	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		endpoint := endpoints[(attempt-1)%len(endpoints)]
		req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewBuffer(jsonBody))
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("RPC request failed: %w", err)
		} else {
			status := resp.StatusCode
			var rpcResp rpcResponse
			decodeErr := json.NewDecoder(resp.Body).Decode(&rpcResp)
			resp.Body.Close()
			if decodeErr != nil {
				lastErr = fmt.Errorf("failed to decode response: %w", decodeErr)
			} else if status == http.StatusTooManyRequests {
				lastErr = errors.New("RPC error: Connection rate limits exceeded")
			} else if rpcResp.Error != nil {
				lastErr = fmt.Errorf("RPC error: %s", rpcResp.Error.Message)
			} else if string(rpcResp.Result) == "null" {
				lastErr = errors.New("transaction not found")
			} else {
				var txResult TransactionResult
				if err := json.Unmarshal(rpcResp.Result, &txResult); err != nil {
					return nil, fmt.Errorf("failed to parse transaction: %w", err)
				}
				if txResult.Meta != nil && txResult.Meta.Err != nil {
					return nil, fmt.Errorf("transaction failed on-chain: %v", txResult.Meta.Err)
				}
				logging.Info().
					Str("tx_hash", txHash).
					Str("rpc", endpoint).
					Uint64("slot", txResult.Slot).
					Msg("Solana transaction verified")
				rpcEndpoint = endpoint
				return &txResult, nil
			}
		}

		msg := ""
		if lastErr != nil {
			msg = strings.ToLower(lastErr.Error())
		}
		retryable := lastErr != nil && (strings.Contains(msg, "not found") ||
			strings.Contains(msg, "rpc request failed") ||
			strings.Contains(msg, "rate limit") ||
			strings.Contains(msg, "429") ||
			strings.Contains(msg, "too many") ||
			strings.Contains(msg, "timeout") ||
			strings.Contains(msg, "temporar"))
		if !retryable || attempt == maxAttempts {
			if lastErr != nil {
				return nil, lastErr
			}
			return nil, errors.New("transaction not found")
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(retryDelay):
		}
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, errors.New("transaction not found")
}

// VerifyTransferAmount verifies the transfer amount to a specific recipient
func VerifyTransferAmount(tx *TransactionResult, recipient string, expectedLamports uint64) (bool, float64, error) {
	if tx.Meta == nil {
		return false, 0, errors.New("transaction has no metadata")
	}

	// Log all account keys for debugging
	logging.Debug().
		Str("recipient_expected", recipient).
		Int("num_accounts", len(tx.Transaction.Message.AccountKeys)).
		Strs("account_keys", tx.Transaction.Message.AccountKeys).
		Msg("Checking transaction accounts for recipient")

	// Find recipient in account keys
	recipientIndex := -1
	for i, acc := range tx.Transaction.Message.AccountKeys {
		if acc == recipient {
			recipientIndex = i
			break
		}
	}

	if recipientIndex == -1 {
		return false, 0, fmt.Errorf("recipient %s not found in transaction accounts: %v", recipient, tx.Transaction.Message.AccountKeys)
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

// GetTreasuryAddressFromDB returns the platform treasury address from database
func GetTreasuryAddressFromDB() string {
	return db.GetSystemSetting("solana_treasury_address", "SOLANA_TREASURY_ADDRESS", os.Getenv("SOLANA_TREASURY_ADDRESS"))
}

// GetTransactionSender returns the sender (fee payer) of the transaction
// In Solana, the first account key in the transaction message is the fee payer (sender)
func GetTransactionSender(tx *TransactionResult) (string, error) {
	if tx.Transaction.Message.AccountKeys == nil || len(tx.Transaction.Message.AccountKeys) == 0 {
		return "", errors.New("transaction has no account keys")
	}
	// The first account key is always the fee payer (sender)
	return tx.Transaction.Message.AccountKeys[0], nil
}
