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
	InnerInstructions []TxInnerInstructions `json:"innerInstructions"`
	LogMessages       []string    `json:"logMessages"`
	LoadedAddresses   *TxLoadedAddresses `json:"loadedAddresses"`
}

// TxLoadedAddresses carries v0 address-lookup-table accounts. Balance
// arrays are indexed: static keys, then loaded writable, then readonly.
type TxLoadedAddresses struct {
	Writable []string `json:"writable"`
	Readonly []string `json:"readonly"`
}

type TxInnerInstructions struct {
	Index        int               `json:"index"`
	Instructions []TxInstruction   `json:"instructions"`
}

// TxInstruction is a jsonParsed instruction. Only System Program
// transfers are interpreted for deposit proof (P0-6).
type TxInstruction struct {
	Program   string `json:"program"`
	ProgramID string `json:"programId"`
	Parsed    *TxParsedInstruction `json:"parsed"`
}

type TxParsedInstruction struct {
	Type string `json:"type"`
	Info TxTransferInfo `json:"info"`
}

type TxTransferInfo struct {
	Source      string `json:"source"`
	Destination string `json:"destination"`
	Lamports    uint64 `json:"lamports"`
}

type TxDetail struct {
	Message    TxMessage `json:"message"`
	Signatures []string  `json:"signatures"`
}

// TxAccountKey is a jsonParsed account key. It also unmarshals the plain
// string form returned by the legacy `json` encoding (Signer then stays
// false; only index 0 — the fee payer — is a signer by construction).
type TxAccountKey struct {
	Pubkey   string `json:"pubkey"`
	Signer   bool   `json:"signer"`
	Writable bool   `json:"writable"`
}

func (k *TxAccountKey) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		k.Pubkey = s
		return nil
	}
	type alias TxAccountKey
	var obj alias
	if err := json.Unmarshal(data, &obj); err != nil {
		return err
	}
	*k = TxAccountKey(obj)
	return nil
}

type TxMessage struct {
	AccountKeys  []TxAccountKey  `json:"accountKeys"`
	Instructions []TxInstruction `json:"instructions"`
}

// AllAccountKeys returns every account key in balance-index order:
// static message keys, then v0 loaded writable, then loaded readonly.
func (tx *TransactionResult) AllAccountKeys() []string {
	keys := make([]string, 0, len(tx.Transaction.Message.AccountKeys))
	for _, k := range tx.Transaction.Message.AccountKeys {
		keys = append(keys, k.Pubkey)
	}
	if tx.Meta != nil && tx.Meta.LoadedAddresses != nil {
		keys = append(keys, tx.Meta.LoadedAddresses.Writable...)
		keys = append(keys, tx.Meta.LoadedAddresses.Readonly...)
	}
	return keys
}

// SystemTransfer is one proven System Program lamport transfer leg.
type SystemTransfer struct {
	Source      string
	Destination string
	Lamports    uint64
}

// SystemTransfers extracts instruction-level transfer proof (top-level
// and CPI inner instructions) from a jsonParsed transaction.
func (tx *TransactionResult) SystemTransfers() []SystemTransfer {
	var out []SystemTransfer
	collect := func(ixs []TxInstruction) {
		for _, ix := range ixs {
			if ix.Parsed == nil || ix.Parsed.Type != "transfer" {
				continue
			}
			if ix.Program != "system" && ix.ProgramID != "11111111111111111111111111111111" {
				continue
			}
			info := ix.Parsed.Info
			if info.Source == "" || info.Destination == "" || info.Lamports == 0 {
				continue
			}
			out = append(out, SystemTransfer{Source: info.Source, Destination: info.Destination, Lamports: info.Lamports})
		}
	}
	collect(tx.Transaction.Message.Instructions)
	if tx.Meta != nil {
		for _, inner := range tx.Meta.InnerInstructions {
			collect(inner.Instructions)
		}
	}
	return out
}

// HasParsedInstructions reports whether instruction-level proof is present.
func (tx *TransactionResult) HasParsedInstructions() bool {
	return len(tx.Transaction.Message.Instructions) > 0
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
				"encoding":                       "jsonParsed",
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

// VerifyTransferAmount keeps the legacy signature for the ops recredit
// path (any source). Credit is proven at instruction level (P0-6).
func VerifyTransferAmount(tx *TransactionResult, recipient string, expectedLamports uint64) (bool, float64, error) {
	lamports, err := VerifyDepositTransfers(tx, recipient, "")
	if err != nil {
		return false, 0, err
	}
	receivedSOL := float64(lamports) / 1e9
	if expectedLamports > 0 && lamports < expectedLamports {
		return false, receivedSOL, fmt.Errorf("received %.9f SOL, expected %.9f SOL", receivedSOL, float64(expectedLamports)/1e9)
	}
	return true, receivedSOL, nil
}

// VerifyDepositTransfers proves, at instruction level, the lamports a
// recipient received via System Program transfers (integer lamports — no
// float anywhere in the proof). Rules (P0-6, W-06):
//   - instruction-level proof is mandatory; balance deltas alone never
//     credit (they can come from rent refunds, fee rebates, self-moves);
//   - when expectedSource != "", only legs sourced from it count
//     (deposit handler passes the fee payer = linked wallet);
//   - the recipient must not be the fee payer (a deposit destination
//     paying its own fee is not a user deposit shape);
//   - the recipient balance delta (bounds-checked across static + v0
//     loaded keys) must cover credited - sent-by-recipient, so the
//     instructed amount really arrived net of same-tx outflows.
func VerifyDepositTransfers(tx *TransactionResult, recipient, expectedSource string) (uint64, error) {
	if tx == nil || tx.Meta == nil {
		return 0, errors.New("transaction has no metadata")
	}
	if !tx.HasParsedInstructions() {
		return 0, errors.New("instruction-level proof unavailable (jsonParsed required)")
	}
	sender, err := GetTransactionSender(tx)
	if err != nil {
		return 0, err
	}
	if recipient == sender {
		return 0, errors.New("recipient is the fee payer; not a deposit")
	}

	var credited, sentByRecipient uint64
	for _, tr := range tx.SystemTransfers() {
		if tr.Destination == recipient && (expectedSource == "" || tr.Source == expectedSource) {
			credited += tr.Lamports
		}
		if tr.Source == recipient {
			sentByRecipient += tr.Lamports
		}
	}
	if credited == 0 {
		return 0, fmt.Errorf("no System Program transfer to recipient %s", recipient)
	}

	keys := tx.AllAccountKeys()
	recipientIndex := -1
	for i, k := range keys {
		if k == recipient {
			recipientIndex = i
			break
		}
	}
	if recipientIndex == -1 {
		return 0, fmt.Errorf("recipient %s not found in transaction accounts", recipient)
	}
	if recipientIndex >= len(tx.Meta.PreBalances) || recipientIndex >= len(tx.Meta.PostBalances) {
		return 0, errors.New("balance arrays do not cover recipient index (v0/ALT mismatch)")
	}
	pre := tx.Meta.PreBalances[recipientIndex]
	post := tx.Meta.PostBalances[recipientIndex]
	var delta int64 = int64(post) - int64(pre)
	net := int64(credited) - int64(sentByRecipient)
	if delta < net {
		return 0, fmt.Errorf("balance delta %d does not cover instructed net transfer %d", delta, net)
	}
	return credited, nil
}

// GetTreasuryAddressFromDB returns the platform treasury address from database
func GetTreasuryAddressFromDB() string {
	return db.GetSystemSetting("solana_treasury_address", "SOLANA_TREASURY_ADDRESS", os.Getenv("SOLANA_TREASURY_ADDRESS"))
}

// GetTransactionSender returns the fee payer of the transaction. The fee
// payer is the first account key and is always a signer; when the
// jsonParsed signer flags are present the sender must agree with them.
func GetTransactionSender(tx *TransactionResult) (string, error) {
	keys := tx.Transaction.Message.AccountKeys
	if len(keys) == 0 {
		return "", errors.New("transaction has no account keys")
	}
	feePayer := keys[0]
	if feePayer.Pubkey == "" {
		return "", errors.New("transaction fee payer is empty")
	}
	// If any signer flags were parsed, the fee payer must be one of them.
	anySigner := false
	for _, k := range keys {
		if k.Signer {
			anySigner = true
			break
		}
	}
	if anySigner && !feePayer.Signer {
		return "", errors.New("fee payer is not a signer")
	}
	return feePayer.Pubkey, nil
}
