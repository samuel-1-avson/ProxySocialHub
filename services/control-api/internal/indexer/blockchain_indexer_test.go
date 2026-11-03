package indexer

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
	"github.com/gagliardetto/solana-go/rpc/jsonrpc"
)

// rpcErr mimics what GetBlockWithOpts returns, wrapped the way indexSlot wraps it.
func rpcErr(slot uint64, code int, message string) error {
	return fmt.Errorf("failed to get block %d: %w", slot, &jsonrpc.RPCError{Code: code, Message: message})
}

func TestIsIndexerRPCQuotaError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"helius max usage", errors.New("status code: 429 ... max usage reached"), true},
		{"jsonrpc 429", errors.New("(*jsonrpc.RPCError)({ Code: (int) 429, Message: Connection rate limits exceeded })"), true},
		{"onfinality throttle", errors.New("(*jsonrpc.RPCError)({ Code: (int) -32029, Message: Too Many Requests, Please apply an OnFinality API key })"), true},
		{"helius 32429", errors.New("code 32429: exceeded credit limit"), true},
		{"text -32429", errors.New("(*jsonrpc.RPCError)({ Code: (int) -32429, Message: credits exhausted })"), true},
		{"rpc error 429", rpcErr(518141582, 429, "Too many requests for a specific RPC call"), true},
		{"slot skipped", errors.New("failed to get block 1: block not available"), false},
		{"connection refused", errors.New("connection refused"), false},
		// The slot number is part of the message; "429" inside it is not a rate limit.
		{"slot number containing 429", errors.New("failed to get block 518429001: connection reset by peer"), false},
		{"slot number containing 32429", errors.New("failed to get block 518324290: unexpected EOF"), false},
		{"unsupported version", rpcErr(518429001, -32015, "Transaction version (1) is not supported by the requesting client."), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isIndexerRPCQuotaError(tc.err); got != tc.want {
				t.Fatalf("isIndexerRPCQuotaError(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

func TestIsIndexerPermanentSlotError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"skipped", rpcErr(1, -32007, "Slot 1 was skipped, or missing due to ledger jump to recent snapshot"), true},
		{"missing in long-term storage", rpcErr(1, -32009, "Slot 1 was skipped, or missing in long-term storage"), true},
		{"unsupported tx version", rpcErr(1, -32015, "Transaction version (1) is not supported by the requesting client."), true},
		{"block not available yet", rpcErr(1, -32004, "Block not available for slot 1"), false},
		{"rate limited", rpcErr(1, 429, "Too many requests for a specific RPC call"), false},
		{"plain error", errors.New("connection refused"), false},
		{"nil", nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isIndexerPermanentSlotError(tc.err); got != tc.want {
				t.Fatalf("isIndexerPermanentSlotError(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

func TestBlockRequestOptsAcceptsV1Transactions(t *testing.T) {
	opts := blockRequestOpts()
	if opts.MaxSupportedTransactionVersion == nil || *opts.MaxSupportedTransactionVersion != 1 {
		t.Fatalf("MaxSupportedTransactionVersion = %v, want 1: devnet blocks carry v1 transactions", opts.MaxSupportedTransactionVersion)
	}
}

// devnetV1Tx is a public version-1 transaction from Solana devnet slot 518145109
// (fetched 2026-11-03 with maxSupportedTransactionVersion=1, base64 encoding).
const devnetV1Tx = "gQEAAg8AAAC5DXQ7bSZW//912BucXdKh+IgOI1tBHLb2F1N2C0uyswEEGDtEme1xaMHcDHkusCTB2lJh/Qf0Mwfmaq3keqiGG6eNR04Wvp1L7zj4dTdPKKMFeTEd+xctLV82Dx7bYwpBrwan1RcYx3TJKFZjmGkdXraLXrijm0ttXHNVWyEAAAAAnzLanB9sElDAm3M5I+zDZw0oY+fUapwc9H39u9DV/lcAAAAAAAAAADAAAAAA6AMAAwMhAAABAgpQHk+dX3nkGAAAAAAAgCaQxxYiXAAAAAAAAAAAAgACAIx4M4ZXsDUKmYmh6EIo1HzlSVm8zkrPh1xn3AH0EKOsFNLlDXCg4h12hSyLgm0mThKjBS4HGHwQsjLu9myz+Ao="

func TestDecodesDevnetV1Transaction(t *testing.T) {
	var twm rpc.TransactionWithMeta
	if err := json.Unmarshal([]byte(`{"transaction":["`+devnetV1Tx+`","base64"]}`), &twm); err != nil {
		t.Fatalf("unmarshal block transaction: %v", err)
	}
	tx, err := twm.GetTransaction()
	if err != nil {
		t.Fatalf("GetTransaction on a v1 transaction: %v", err)
	}
	if len(tx.Signatures) == 0 {
		t.Fatal("decoded v1 transaction has no signature")
	}
	if got := tx.Message.GetVersion(); got != solana.MessageVersionV1 {
		t.Fatalf("message version = %d, want MessageVersionV1", got)
	}
	if len(tx.Message.AccountKeys) == 0 {
		t.Fatal("decoded v1 transaction has no account keys, so the program filter could not run")
	}
}

func TestIndexSlotRangeMovesPastBlocksItCannotFetch(t *testing.T) {
	// The 2026-10-31 stall: every block in the batch answered -32015.
	bi := &BlockchainIndexer{lastSlot: 100}
	err := bi.indexSlotRange(101, 110, func(slot uint64) error {
		return rpcErr(slot, rpcErrUnsupportedTxVersion, "Transaction version (1) is not supported")
	})
	if err != nil {
		t.Fatalf("indexSlotRange returned %v, want nil", err)
	}
	if bi.lastSlot != 110 {
		t.Fatalf("lastSlot = %d, want 110 (past the batch)", bi.lastSlot)
	}
}

func TestIndexSlotRangeStopsOnRateLimit(t *testing.T) {
	bi := &BlockchainIndexer{lastSlot: 0}
	err := bi.indexSlotRange(1, 5, func(slot uint64) error {
		if slot == 3 {
			return rpcErr(slot, 429, "Too many requests for a specific RPC call")
		}
		return nil
	})
	if !isIndexerRPCQuotaError(err) {
		t.Fatalf("indexSlotRange returned %v, want the rate-limit error", err)
	}
	if bi.lastSlot != 2 {
		t.Fatalf("lastSlot = %d, want 2 (stop before the throttled slot)", bi.lastSlot)
	}
}

func TestIndexSlotRangeGivesUpAfterRepeatedFailures(t *testing.T) {
	bi := &BlockchainIndexer{lastSlot: 6}
	boom := func(uint64) error { return errors.New("boom") }
	for attempt := 1; attempt < maxSlotAttempts; attempt++ {
		if err := bi.indexSlotRange(7, 7, boom); err != nil {
			t.Fatalf("attempt %d: %v", attempt, err)
		}
		if bi.lastSlot != 6 {
			t.Fatalf("attempt %d: lastSlot = %d, want 6 (still retrying slot 7)", attempt, bi.lastSlot)
		}
	}
	if err := bi.indexSlotRange(7, 7, boom); err != nil {
		t.Fatalf("final attempt: %v", err)
	}
	if bi.lastSlot != 7 {
		t.Fatalf("lastSlot = %d, want 7 after %d attempts", bi.lastSlot, maxSlotAttempts)
	}
	if len(bi.slotFailures) != 0 {
		t.Fatalf("slotFailures = %v, want empty once the slot is passed", bi.slotFailures)
	}
}

func TestIndexSlotRangeLaterSuccessPassesAnEarlierFailure(t *testing.T) {
	bi := &BlockchainIndexer{lastSlot: 0}
	err := bi.indexSlotRange(1, 3, func(slot uint64) error {
		if slot == 2 {
			return errors.New("boom")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("indexSlotRange returned %v", err)
	}
	if bi.lastSlot != 3 {
		t.Fatalf("lastSlot = %d, want 3", bi.lastSlot)
	}
	if len(bi.slotFailures) != 0 {
		t.Fatalf("slotFailures = %v, want empty: slot 2 is behind the watermark", bi.slotFailures)
	}
}
