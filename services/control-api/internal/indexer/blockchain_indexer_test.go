package indexer

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
	"github.com/gagliardetto/solana-go/rpc/jsonrpc"
	"github.com/glebarez/sqlite"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
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

// setupIndexerSQLite points db.DB at an in-memory database holding only the
// tables a test asks for, in the style of the explorer metrics lag tests.
func setupIndexerSQLite(t *testing.T, ddls ...string) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open("file:indexer_"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	for _, ddl := range ddls {
		if err := gdb.Exec(ddl).Error; err != nil {
			t.Fatalf("create table: %v", err)
		}
	}
	previous := db.DB
	db.DB = gdb
	t.Cleanup(func() { db.DB = previous })
	return gdb
}

func TestMaxIndexedSlot(t *testing.T) {
	gdb := setupIndexerSQLite(t, `CREATE TABLE explorer_blocks (
		block_number INTEGER,
		chain TEXT,
		is_orphaned BOOLEAN
	)`)
	bi := &BlockchainIndexer{}
	if slot, ok := bi.maxIndexedSlot(); ok || slot != 0 {
		t.Fatalf("empty table: got (%d, %v), want (0, false)", slot, ok)
	}
	for _, row := range []struct {
		number   uint64
		chain    string
		orphaned bool
	}{
		{100, "solana", false},
		{150, "solana", true},    // an orphaned head is not a resume point
		{999, "ethereum", false}, // other chains do not count
	} {
		if err := gdb.Exec(`INSERT INTO explorer_blocks (block_number, chain, is_orphaned) VALUES (?, ?, ?)`, row.number, row.chain, row.orphaned).Error; err != nil {
			t.Fatalf("insert block: %v", err)
		}
	}
	if slot, ok := bi.maxIndexedSlot(); !ok || slot != 100 {
		t.Fatalf("got (%d, %v), want (100, true): newest canonical solana block", slot, ok)
	}
}

func TestMaxIndexedSlotWithoutDB(t *testing.T) {
	previous := db.DB
	db.DB = nil
	t.Cleanup(func() { db.DB = previous })
	bi := &BlockchainIndexer{}
	if slot, ok := bi.maxIndexedSlot(); ok || slot != 0 {
		t.Fatalf("nil db: got (%d, %v), want (0, false)", slot, ok)
	}
}

const explorerTransactionsDDL = `CREATE TABLE explorer_transactions (
	id TEXT PRIMARY KEY,
	tx_hash TEXT,
	chain TEXT,
	block_hash TEXT,
	block_number INTEGER,
	from_address TEXT,
	to_address TEXT,
	amount REAL,
	currency TEXT,
	token_mint TEXT,
	is_orphaned BOOLEAN,
	fee REAL,
	status TEXT,
	tx_type TEXT,
	program_id TEXT,
	timestamp DATETIME,
	confirmations INTEGER,
	raw_data TEXT,
	created_at DATETIME,
	updated_at DATETIME
)`

func TestIndexTransactionStoresBlockTime(t *testing.T) {
	gdb := setupIndexerSQLite(t, explorerTransactionsDDL)

	var twm rpc.TransactionWithMeta
	if err := json.Unmarshal([]byte(`{"transaction":["`+devnetV1Tx+`","base64"]}`), &twm); err != nil {
		t.Fatalf("unmarshal block transaction: %v", err)
	}

	blockTime := time.Date(2026, 11, 3, 17, 1, 58, 0, time.UTC)
	bi := &BlockchainIndexer{indexAll: true, programID: solana.SystemProgramID}
	if err := bi.indexTransaction(&twm, 518145109, "blockhash", blockTime, 0); err != nil {
		t.Fatalf("indexTransaction: %v", err)
	}

	var stored models.ExplorerTransaction
	if err := gdb.First(&stored).Error; err != nil {
		t.Fatalf("read stored transaction: %v", err)
	}
	if stored.Timestamp.Unix() != blockTime.Unix() {
		t.Fatalf("timestamp = %v, want the block time %v, not the indexing time", stored.Timestamp, blockTime)
	}
}

func TestIndexTransactionFallsBackToNowWithoutBlockTime(t *testing.T) {
	gdb := setupIndexerSQLite(t, explorerTransactionsDDL)

	var twm rpc.TransactionWithMeta
	if err := json.Unmarshal([]byte(`{"transaction":["`+devnetV1Tx+`","base64"]}`), &twm); err != nil {
		t.Fatalf("unmarshal block transaction: %v", err)
	}

	bi := &BlockchainIndexer{indexAll: true, programID: solana.SystemProgramID}
	before := time.Now().Add(-time.Second)
	if err := bi.indexTransaction(&twm, 518145109, "blockhash", time.Time{}, 0); err != nil {
		t.Fatalf("indexTransaction: %v", err)
	}
	after := time.Now().Add(time.Second)

	var stored models.ExplorerTransaction
	if err := gdb.First(&stored).Error; err != nil {
		t.Fatalf("read stored transaction: %v", err)
	}
	if stored.Timestamp.Before(before) || stored.Timestamp.After(after) {
		t.Fatalf("timestamp = %v, want within [%v, %v]", stored.Timestamp, before, after)
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
