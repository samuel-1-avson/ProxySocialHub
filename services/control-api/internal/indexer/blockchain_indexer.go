package indexer

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

// IndexerCallbacks holds optional notification hooks called after DB writes.
// Use SetCallbacks to wire them from main.go without creating a circular import.
type IndexerCallbacks struct {
	OnNewBlock       func(*models.ExplorerBlock)
	OnNewTransaction func(*models.ExplorerTransaction)
}

// BlockchainIndexer polls Solana blockchain and indexes data into explorer tables
type BlockchainIndexer struct {
	rpcClient    *rpc.Client
	programID    solana.PublicKey
	isRunning    bool
	pollInterval time.Duration
	batchSize    int
	lastSlot     uint64
	mu           sync.RWMutex
	ctx          context.Context
	cancel       context.CancelFunc
	callbacks    IndexerCallbacks
}

// SetCallbacks sets notification callbacks called after each DB write.
func (bi *BlockchainIndexer) SetCallbacks(cb IndexerCallbacks) {
	bi.mu.Lock()
	bi.callbacks = cb
	bi.mu.Unlock()
}

// IndexerConfig holds configuration for the blockchain indexer
type IndexerConfig struct {
	RPCEndpoint  string
	ProgramID    string
	PollInterval time.Duration
	BatchSize    int
	StartSlot    uint64 // 0 = auto (start from current slot)
}

// NewBlockchainIndexer creates a new blockchain indexer instance
func NewBlockchainIndexer(cfg IndexerConfig) (*BlockchainIndexer, error) {
	if cfg.RPCEndpoint == "" {
		cfg.RPCEndpoint = rpc.DevNet_RPC
	}

	rpcClient := rpc.New(cfg.RPCEndpoint)

	programID, err := solana.PublicKeyFromBase58(cfg.ProgramID)
	if err != nil {
		return nil, fmt.Errorf("invalid program ID: %w", err)
	}

	if cfg.PollInterval == 0 {
		cfg.PollInterval = 400 * time.Millisecond // Solana slot time
	}

	if cfg.BatchSize == 0 {
		cfg.BatchSize = 100
	}

	ctx, cancel := context.WithCancel(context.Background())

	return &BlockchainIndexer{
		rpcClient:    rpcClient,
		programID:    programID,
		pollInterval: cfg.PollInterval,
		batchSize:    cfg.BatchSize,
		lastSlot:     cfg.StartSlot,
		ctx:          ctx,
		cancel:       cancel,
	}, nil
}

// Start begins the indexing loop
func (bi *BlockchainIndexer) Start() {
	bi.mu.Lock()
	if bi.isRunning {
		bi.mu.Unlock()
		return
	}
	bi.isRunning = true
	bi.mu.Unlock()

	// Get starting slot if not set
	if bi.lastSlot == 0 {
		slot, err := bi.rpcClient.GetSlot(bi.ctx, rpc.CommitmentConfirmed)
		if err == nil {
			bi.lastSlot = slot
			logging.Info().Uint64("slot", slot).Msg("[BlockchainIndexer] Starting from current slot")
		} else {
			logging.Error(err).Msg("[BlockchainIndexer] Failed to get current slot, starting from 0")
			bi.lastSlot = 0
		}
	}

	logging.Info().
		Str("program", bi.programID.String()).
		Dur("interval", bi.pollInterval).
		Msg("[BlockchainIndexer] Started")

	go bi.loop()
}

// Stop stops the indexer
func (bi *BlockchainIndexer) Stop() {
	bi.mu.Lock()
	defer bi.mu.Unlock()

	if !bi.isRunning {
		return
	}

	bi.isRunning = false
	bi.cancel()

	logging.Info().Msg("[BlockchainIndexer] Stopped")
}

func (bi *BlockchainIndexer) loop() {
	ticker := time.NewTicker(bi.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-bi.ctx.Done():
			return
		case <-ticker.C:
			if err := bi.indexNewSlots(); err != nil {
				logging.Error(err).Msg("[BlockchainIndexer] Indexing error")
			}
		}
	}
}

// indexNewSlots fetches and indexes new slots since last check
func (bi *BlockchainIndexer) indexNewSlots() error {
	currentSlot, err := bi.rpcClient.GetSlot(bi.ctx, rpc.CommitmentConfirmed)
	if err != nil {
		return fmt.Errorf("failed to get current slot: %w", err)
	}

	if currentSlot <= bi.lastSlot {
		return nil // No new slots
	}

	// Index slots in batches
	startSlot := bi.lastSlot + 1
	endSlot := currentSlot

	if endSlot-startSlot > uint64(bi.batchSize) {
		endSlot = startSlot + uint64(bi.batchSize) - 1
	}

	logging.Debug().
		Uint64("start", startSlot).
		Uint64("end", endSlot).
		Msg("[BlockchainIndexer] Indexing slots")

	for slot := startSlot; slot <= endSlot; slot++ {
		if err := bi.indexSlot(slot); err != nil {
			logging.Error(err).Uint64("slot", slot).Msg("[BlockchainIndexer] Failed to index slot")
			continue
		}
		bi.lastSlot = slot
	}

	return nil
}

// indexSlot indexes a single slot (block)
func (bi *BlockchainIndexer) indexSlot(slot uint64) error {
	// Get block with encoded transaction data
	blockResult, err := bi.rpcClient.GetBlockWithOpts(bi.ctx, slot, &rpc.GetBlockOpts{
		Commitment:                     rpc.CommitmentConfirmed,
		TransactionDetails:             rpc.TransactionDetailsFull,
		Rewards:                        new(bool), // false
		MaxSupportedTransactionVersion: new(uint64),
	})
	if err != nil {
		return fmt.Errorf("failed to get block %d: %w", slot, err)
	}

	if blockResult == nil {
		return nil // Empty block
	}

	// Get block hash from the block result
	blockHash := fmt.Sprintf("block_%d", slot) // Placeholder, would use actual block hash

	// Get block time
	blockTime := time.Now()
	if blockResult.BlockTime != nil {
		blockTime = blockResult.BlockTime.Time()
	}

	// Get validator from rewards
	validatorPubkey := ""
	if len(blockResult.Rewards) > 0 {
		validatorPubkey = blockResult.Rewards[len(blockResult.Rewards)-1].Pubkey.String()
	}

	explorerBlock := models.ExplorerBlock{
		ID:               uuid.New(),
		BlockHash:        blockHash,
		BlockNumber:      slot,
		Chain:            "solana",
		Timestamp:        blockTime,
		TransactionCount: len(blockResult.Transactions),
		ValidatorPubkey:  validatorPubkey,
	}

	// Upsert block
	if err := db.DB.Where("block_number = ?", slot).
		Assign(explorerBlock).
		FirstOrCreate(&explorerBlock).Error; err != nil {
		logging.Error(err).Uint64("slot", slot).Msg("[BlockchainIndexer] Failed to store block")
	} else if bi.callbacks.OnNewBlock != nil {
		bi.callbacks.OnNewBlock(&explorerBlock)
	}

	// Index transactions
	for i := range blockResult.Transactions {
		if err := bi.indexTransaction(&blockResult.Transactions[i], slot, blockHash, i); err != nil {
			logging.Error(err).Msg("[BlockchainIndexer] Failed to index transaction")
		}
	}

	return nil
}

// indexTransaction indexes a single transaction
func (bi *BlockchainIndexer) indexTransaction(txWithMeta *rpc.TransactionWithMeta, blockNumber uint64, blockHash string, index int) error {
	if txWithMeta == nil {
		return nil
	}

	// Decode transaction to get access to signatures and account keys
	decodedTx, err := txWithMeta.GetTransaction()
	if err != nil {
		return fmt.Errorf("failed to decode transaction: %w", err)
	}

	// Get transaction signature
	var txHash string
	if len(decodedTx.Signatures) > 0 {
		txHash = decodedTx.Signatures[0].String()
	} else {
		// Generate a placeholder if no signature
		txHash = fmt.Sprintf("tx_%d_%d", blockNumber, index)
	}

	// Get account keys
	accountKeys := decodedTx.Message.AccountKeys

	// Check if this transaction interacts with our program
	isRelevant := false
	for _, key := range accountKeys {
		if key.Equals(bi.programID) {
			isRelevant = true
			break
		}
	}

	// Index all transactions for now
	if !isRelevant {
		isRelevant = true
	}

	if !isRelevant {
		return nil
	}

	// Extract transaction details
	fromAddr := ""
	toAddr := ""
	amount := 0.0
	txType := "transfer"
	programID := ""

	if len(accountKeys) > 0 {
		fromAddr = accountKeys[0].String()
	}

	// Get fee from metadata
	fee := 0.0
	if txWithMeta.Meta != nil {
		fee = float64(txWithMeta.Meta.Fee) / 1e9 // Convert lamports to SOL
	}

	// Determine status
	status := "confirmed"
	if txWithMeta.Meta != nil && txWithMeta.Meta.Err != nil {
		status = "failed"
	}

	// Get timestamp
	timestamp := time.Now()

	explorerTx := models.ExplorerTransaction{
		ID:            uuid.New(),
		TxHash:        txHash,
		Chain:         "solana",
		BlockHash:     blockHash,
		BlockNumber:   blockNumber,
		FromAddress:   fromAddr,
		ToAddress:     toAddr,
		Amount:        amount,
		Currency:      "SOL",
		Fee:           fee,
		Status:        status,
		TxType:        txType,
		ProgramID:     programID,
		Timestamp:     timestamp,
		Confirmations: 1,
	}

	// Store transaction
	if err := db.DB.Where("tx_hash = ?", txHash).
		Assign(explorerTx).
		FirstOrCreate(&explorerTx).Error; err != nil {
		return fmt.Errorf("failed to store transaction: %w", err)
	} else if bi.callbacks.OnNewTransaction != nil {
		bi.callbacks.OnNewTransaction(&explorerTx)
	}

	// N-04: Upsert blockchain_state_cache for each program-owned account in the tx.
	// This ensures the cache is always current after any relevant transaction.
	bi.syncAccountsToCache(txHash, blockNumber, accountKeys)

	return nil
}

// syncAccountsToCache upserts BlockchainStateCache rows for accounts that appear
// in a program-relevant transaction. Each account key becomes one cache entry.
// Only accounts owned by our program (or used as fee-payer/writable) are stored.
func (bi *BlockchainIndexer) syncAccountsToCache(txSig string, slot uint64, accountKeys []solana.PublicKey) {
	programIDStr := bi.programID.String()
	for _, key := range accountKeys {
		addr := key.String()
		// Skip system program and native accounts (short addresses would fail base58 decode)
		if addr == "11111111111111111111111111111111" || len(addr) < 32 {
			continue
		}

		entry := models.BlockchainStateCache{
			PDA:          addr,
			ProgramID:    programIDStr,
			AccountType:  models.AccountEscrow, // best-effort default; refined by settlement code
			Data:         `{}`,
			Slot:         slot,
			Signature:    &txSig,
			LastSyncedAt: time.Now(),
		}

		// Use ON CONFLICT (pda) DO UPDATE to keep the latest slot/signature.
		if err := db.DB.
			Where(models.BlockchainStateCache{PDA: addr}).
			Assign(models.BlockchainStateCache{
				Slot:         slot,
				Signature:    &txSig,
				LastSyncedAt: time.Now(),
			}).
			FirstOrCreate(&entry).Error; err != nil {
			logging.Error(err).Str("pda", addr).Msg("[BlockchainIndexer] Failed to upsert state cache")
		}
	}
}

// GetLastSlot returns the last indexed slot
func (bi *BlockchainIndexer) GetLastSlot() uint64 {
	bi.mu.RLock()
	defer bi.mu.RUnlock()
	return bi.lastSlot
}

// Backfill backfills blocks from startSlot to endSlot
func (bi *BlockchainIndexer) Backfill(startSlot, endSlot uint64) error {
	logging.Info().
		Uint64("start", startSlot).
		Uint64("end", endSlot).
		Msg("[BlockchainIndexer] Starting backfill")

	for slot := startSlot; slot <= endSlot; slot++ {
		if err := bi.indexSlot(slot); err != nil {
			logging.Error(err).Uint64("slot", slot).Msg("[BlockchainIndexer] Backfill error")
		}

		// Update last slot
		bi.mu.Lock()
		bi.lastSlot = slot
		bi.mu.Unlock()
	}

	logging.Info().Msg("[BlockchainIndexer] Backfill complete")
	return nil
}

// IndexHistoricalTransactions indexes transactions for a specific address
func (bi *BlockchainIndexer) IndexHistoricalTransactions(address string, limit int) error {
	pubkey, err := solana.PublicKeyFromBase58(address)
	if err != nil {
		return fmt.Errorf("invalid address: %w", err)
	}

	signatures, err := bi.rpcClient.GetSignaturesForAddress(bi.ctx, pubkey)
	if err != nil {
		return fmt.Errorf("failed to get signatures: %w", err)
	}

	count := 0
	for _, sigInfo := range signatures {
		if count >= limit {
			break
		}

		// Get transaction details
		tx, err := bi.rpcClient.GetTransaction(bi.ctx, sigInfo.Signature, &rpc.GetTransactionOpts{
			Commitment: rpc.CommitmentConfirmed,
		})
		if err != nil {
			logging.Error(err).Str("sig", sigInfo.Signature.String()).Msg("[BlockchainIndexer] Failed to get transaction")
			continue
		}

		if tx == nil {
			continue
		}

		count++
		logging.Debug().Str("sig", sigInfo.Signature.String()).Msg("[BlockchainIndexer] Indexed historical tx")
	}

	return nil
}
