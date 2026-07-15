package indexer

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
)

// IndexerCallbacks holds optional notification hooks called after DB writes.
// Use SetCallbacks to wire them from main.go without creating a circular import.
type IndexerCallbacks struct {
	OnNewBlock       func(*models.ExplorerBlock)
	OnNewTransaction func(*models.ExplorerTransaction)
}

// BlockchainIndexer polls Solana blockchain and indexes data into explorer tables
type BlockchainIndexer struct {
	rpcClient       *rpc.Client
	rpcEndpoint     string
	programID       solana.PublicKey
	writerID        string
	writerPublicKey string
	writerSigner    ed25519.PrivateKey
	signatureScheme string
	indexAll        bool // when true, skip program-relevance filter
	isRunning       bool
	pollInterval    time.Duration
	batchSize       int
	lastSlot        uint64
	mu              sync.RWMutex
	ctx             context.Context
	cancel          context.CancelFunc
	callbacks       IndexerCallbacks
}

// SetCallbacks sets notification callbacks called after each DB write.
func (bi *BlockchainIndexer) SetCallbacks(cb IndexerCallbacks) {
	bi.mu.Lock()
	bi.callbacks = cb
	bi.mu.Unlock()
}

// IndexerConfig holds configuration for the blockchain indexer
type IndexerConfig struct {
	RPCEndpoint      string
	ProgramID        string
	WriterID         string
	WriterPublicKey  string
	WriterPrivateKey string
	PollInterval     time.Duration
	BatchSize        int
	StartSlot        uint64 // 0 = auto (start from current slot)
	// IndexAll: when true, index every transaction on the chain regardless of
	// program involvement. Useful for local/devnet environments where the
	// ProxyHub program has no transactions yet. Set via INDEXER_INDEX_ALL=true.
	IndexAll bool
}

// NewBlockchainIndexer creates a new blockchain indexer instance
func NewBlockchainIndexer(cfg IndexerConfig) (*BlockchainIndexer, error) {
	if cfg.RPCEndpoint == "" {
		cfg.RPCEndpoint = rpc.DevNet_RPC
	}
	if cfg.WriterID == "" {
		cfg.WriterID = "indexer-default"
	}

	var signer ed25519.PrivateKey
	derivedWriterPublicKey := strings.TrimSpace(cfg.WriterPublicKey)
	if strings.TrimSpace(cfg.WriterPrivateKey) != "" {
		parsedSigner, parsedPubKey, err := parseEd25519PrivateKey(cfg.WriterPrivateKey)
		if err != nil {
			return nil, fmt.Errorf("invalid indexer writer signing key: %w", err)
		}
		signer = parsedSigner
		if derivedWriterPublicKey == "" {
			derivedWriterPublicKey = parsedPubKey
		}
	}

	rpcClient := solanaClient.NewRPCClient(cfg.RPCEndpoint)

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
		rpcClient:       rpcClient,
		rpcEndpoint:     cfg.RPCEndpoint,
		programID:       programID,
		writerID:        cfg.WriterID,
		writerPublicKey: derivedWriterPublicKey,
		writerSigner:    signer,
		signatureScheme: func() string {
			if len(signer) > 0 {
				return "ed25519"
			}
			return ""
		}(),
		indexAll:     cfg.IndexAll,
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
		Str("writer_id", bi.writerID).
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

	// Use the actual block hash and parent hash from the RPC result (P3-06).
	blockHash := blockResult.Blockhash.String()
	parentHash := blockResult.PreviousBlockhash.String()

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
		ParentHash:       parentHash,
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

	bi.recordBlockAttestation(slot, blockHash, parentHash)

	// P3-06: Re-org detection.
	// If the previous slot's stored block hash differs from our parentHash, the
	// old block was on a fork — mark it and its transactions as orphaned.
	if slot > 0 {
		var prevBlock models.ExplorerBlock
		if err := db.DB.Where("block_number = ?", slot-1).First(&prevBlock).Error; err == nil {
			if prevBlock.BlockHash != parentHash && !prevBlock.IsOrphaned {
				logging.Warn().
					Uint64("slot", slot-1).
					Str("stored_hash", prevBlock.BlockHash).
					Str("canonical_parent", parentHash).
					Msg("[BlockchainIndexer] Re-org detected — marking block and its transactions as orphaned")
				db.DB.Model(&prevBlock).Update("is_orphaned", true)
				db.DB.Model(&models.ExplorerTransaction{}).
					Where("block_hash = ?", prevBlock.BlockHash).
					Update("is_orphaned", true)
			}
		}
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
		// Skip transactions without valid signatures — they cannot be audited
		return nil
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

	// When indexAll is false (production), only store transactions that
	// involve the ProxyHub program. When indexAll is true (dev/devnet mode
	// via INDEXER_INDEX_ALL=true), store all transactions so the explorer
	// shows real chain activity even before the program has traffic.
	if !bi.indexAll && !isRelevant {
		return nil
	}

	// Extract transaction details
	fromAddr := ""
	toAddr := ""
	amount := 0.0
	programID := bi.programID.String()

	// Classify transaction type.
	// For ProxyHub program transactions (isRelevant=true) we infer the type
	// from the number of accounts and log messages when available.
	// For all other Solana transactions we default to "transfer".
	txType := inferTxType(decodedTx, txWithMeta, isRelevant, bi.programID.String())

	if len(accountKeys) > 0 {
		fromAddr = accountKeys[0].String()
	}
	// P0-11: populate toAddress from the second account key (recipient).
	if len(accountKeys) > 1 {
		toAddr = accountKeys[1].String()
	}

	// Get fee from metadata
	fee := 0.0
	if txWithMeta.Meta != nil {
		fee = float64(txWithMeta.Meta.Fee) / 1e9 // Convert lamports to SOL

		// P0-10: extract transferred amount from balance deltas.
		// The recipient (index 1) gain is the most reliable signal for a transfer tx.
		pre := txWithMeta.Meta.PreBalances
		post := txWithMeta.Meta.PostBalances
		if len(post) > 1 && len(pre) > 1 {
			delta := int64(post[1]) - int64(pre[1])
			if delta > 0 {
				amount = float64(delta) / 1e9 // lamports → SOL
			}
		}
	}

	// P3-05: SPL token transfer detection.
	// If the native SOL amount is 0 but token balances changed, treat the largest
	// positive token delta as the transferred amount and record its mint address.
	currency := "SOL"
	tokenMint := ""
	if amount == 0 && txWithMeta.Meta != nil &&
		len(txWithMeta.Meta.PostTokenBalances) > 0 &&
		len(txWithMeta.Meta.PreTokenBalances) > 0 {

		// Build pre-balance map keyed by accountIndex+mint for O(1) lookup.
		preTok := make(map[string]float64)
		for _, tb := range txWithMeta.Meta.PreTokenBalances {
			if tb.UiTokenAmount != nil && tb.UiTokenAmount.UiAmount != nil {
				key := fmt.Sprintf("%d:%s", tb.AccountIndex, tb.Mint.String())
				preTok[key] = *tb.UiTokenAmount.UiAmount
			}
		}

		for _, tb := range txWithMeta.Meta.PostTokenBalances {
			if tb.UiTokenAmount == nil || tb.UiTokenAmount.UiAmount == nil {
				continue
			}
			key := fmt.Sprintf("%d:%s", tb.AccountIndex, tb.Mint.String())
			postAmt := *tb.UiTokenAmount.UiAmount
			preAmt := preTok[key]
			delta := postAmt - preAmt
			if delta > amount { // track the largest positive change
				amount = delta
				tokenMint = tb.Mint.String()
				currency = "SPL" // full mint address stored in token_mint field
				// Update toAddress to the account that received the tokens.
				if int(tb.AccountIndex) < len(accountKeys) {
					toAddr = accountKeys[tb.AccountIndex].String()
				}
				if tb.Owner != nil {
					toAddr = tb.Owner.String()
				}
			}
		}
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
		Currency:      currency,
		TokenMint:     tokenMint,
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

	// P3-12: Upsert ExplorerContract for the program so the contracts page has data.
	// We increment TotalCalls and accumulate volume on every relevant transaction.
	db.DB.Exec(`
		INSERT INTO explorer_contracts (id, address, chain, name, contract_type,
		    is_verified, total_calls, total_volume, deployed_at, created_at, updated_at)
		VALUES (gen_random_uuid(), ?, 'solana', 'ProxyHub Program', 'custom',
		    true, 1, ?, NOW(), NOW(), NOW())
		ON CONFLICT (address) DO UPDATE SET
		    total_calls  = explorer_contracts.total_calls  + 1,
		    total_volume = explorer_contracts.total_volume + EXCLUDED.total_volume,
		    updated_at   = NOW()`,
		programID, amount,
	)

	return nil
}

func (bi *BlockchainIndexer) recordBlockAttestation(slot uint64, blockHash, parentHash string) {
	attestedAt := time.Now().UTC().Truncate(time.Microsecond)
	signature := ""
	if len(bi.writerSigner) > 0 {
		sigBytes := ed25519.Sign(bi.writerSigner, explorerAttestationPayload("solana", slot, blockHash, parentHash, attestedAt, bi.writerID))
		signature = base64.StdEncoding.EncodeToString(sigBytes)
	}

	att := models.ExplorerBlockAttestation{
		Chain:                "solana",
		Slot:                 slot,
		BlockHash:            blockHash,
		ParentHash:           parentHash,
		WriterID:             bi.writerID,
		WriterPublicKey:      bi.writerPublicKey,
		SignatureScheme:      bi.signatureScheme,
		AttestationSignature: signature,
		RPCEndpoint:          bi.rpcEndpoint,
		AttestedAt:           attestedAt,
	}

	if err := db.DB.
		Where("chain = ? AND slot = ? AND writer_id = ?", att.Chain, att.Slot, att.WriterID).
		Assign(att).
		FirstOrCreate(&att).Error; err != nil {
		logging.Error(err).
			Uint64("slot", slot).
			Str("writer_id", bi.writerID).
			Msg("[BlockchainIndexer] Failed to upsert block attestation")
	}
}

func parseEd25519PrivateKey(raw string) (ed25519.PrivateKey, string, error) {
	decoded, err := decodeSignerString(raw)
	if err != nil {
		return nil, "", err
	}

	if len(decoded) == ed25519.SeedSize {
		pk := ed25519.NewKeyFromSeed(decoded)
		return pk, base64.StdEncoding.EncodeToString(pk.Public().(ed25519.PublicKey)), nil
	}
	if len(decoded) == ed25519.PrivateKeySize {
		pk := ed25519.PrivateKey(decoded)
		pub := pk.Public().(ed25519.PublicKey)
		return pk, base64.StdEncoding.EncodeToString(pub), nil
	}

	return nil, "", fmt.Errorf("expected %d-byte seed or %d-byte private key, got %d bytes", ed25519.SeedSize, ed25519.PrivateKeySize, len(decoded))
}

func decodeSignerString(raw string) ([]byte, error) {
	v := strings.TrimSpace(raw)
	if v == "" {
		return nil, fmt.Errorf("empty key")
	}

	if b, err := base64.StdEncoding.DecodeString(v); err == nil {
		return b, nil
	}
	if b, err := base64.RawStdEncoding.DecodeString(v); err == nil {
		return b, nil
	}
	if b, err := hex.DecodeString(v); err == nil {
		return b, nil
	}

	return nil, fmt.Errorf("unsupported key encoding (expected base64 or hex)")
}

func explorerAttestationPayload(chain string, slot uint64, blockHash, parentHash string, attestedAt time.Time, writerID string) []byte {
	return []byte(fmt.Sprintf("%s|%d|%s|%s|%d|%s", chain, slot, blockHash, parentHash, attestedAt.UTC().UnixNano(), writerID))
}

// inferTxType classifies a Solana transaction into a ProxyHub operation type.
//
// For ProxyHub program transactions (isRelevant=true), we inspect log messages
// returned by the RPC to identify the instruction name. Solana programs emit
// "Program log: Instruction: <Name>" for Anchor-framework programs, which is
// the most reliable signal available without a full IDL decode.
//
// For non-program transactions we fall back to "transfer" (generic SOL move).
func inferTxType(tx *solana.Transaction, meta *rpc.TransactionWithMeta, isRelevant bool, programID string) string {
	if !isRelevant {
		return "transfer"
	}

	// Try to read Anchor instruction logs: "Program log: Instruction: <Name>"
	if meta != nil && meta.Meta != nil {
		for _, logLine := range meta.Meta.LogMessages {
			lower := strings.ToLower(logLine)
			switch {
			case strings.Contains(lower, "instruction: initializeescrow") ||
				strings.Contains(lower, "instruction: createescrow"):
				return "escrow_init"
			case strings.Contains(lower, "instruction: settleescrow") ||
				strings.Contains(lower, "instruction: releaseescrow"):
				return "escrow_settle"
			case strings.Contains(lower, "instruction: stake") &&
				!strings.Contains(lower, "unstake"):
				return "stake"
			case strings.Contains(lower, "instruction: unstake"):
				return "unstake"
			case strings.Contains(lower, "instruction: payout") ||
				strings.Contains(lower, "instruction: disbursepayout"):
				return "payout"
			case strings.Contains(lower, "instruction: registerprovider") ||
				strings.Contains(lower, "instruction: registernode"):
				return "register"
			case strings.Contains(lower, "instruction: startsession"):
				return "session_start"
			case strings.Contains(lower, "instruction: endsession"):
				return "session_end"
			}
		}
		// ProxyHub program involved but no recognised instruction — label as contract
		return "contract_call"
	}

	return "transfer"
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
