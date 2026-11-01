// Package solana - Event watcher for on-chain escrow creation
package solana

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
	"github.com/gagliardetto/solana-go/rpc/ws"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
)

// EscrowEvent represents an on-chain escrow event
type EscrowEvent struct {
	Type        string    `json:"type"` // "initialized", "settled", "refunded"
	EscrowPDA   string    `json:"escrow_pda"`
	Buyer       string    `json:"buyer"`
	Seller      string    `json:"seller"`
	Amount      uint64    `json:"amount"`
	LimitGB     uint64    `json:"limit_gb"`
	TxSignature string    `json:"tx_signature"`
	Timestamp   time.Time `json:"timestamp"`
}

// EventHandler is called when an escrow event is detected
type EventHandler func(event EscrowEvent)

// Watcher monitors the Solana blockchain for escrow events
type Watcher struct {
	rpcClients     []*rpc.Client
	currentIdx     int
	wsClient       *ws.Client
	programID      sol.PublicKey
	treasuryID     sol.PublicKey   // Primary legacy treasury (compat)
	depositAddrs   []sol.PublicKey // All addresses monitored for native deposits
	handlers       []EventHandler
	pollInterval   time.Duration
	lastSlot       uint64 // legacy compat mirror (max of cursors)
	cursors        map[string]uint64 // W-26: durable per-address watermarks
	pollTicks      int
	running        bool
	mu             sync.RWMutex
	ctx            context.Context
	cancel         context.CancelFunc
}

// WatcherConfig holds configuration for the event watcher
type WatcherConfig struct {
	RPCEndpoints   []string
	WSEndpoint     string   // Optional WebSocket endpoint
	TreasuryAddr   string   // Optional legacy treasury address to monitor
	DepositAddrs   []string // Optional additional deposit destinations (vault, etc.)
	PollInterval   time.Duration
}

// NewWatcher creates a new event watcher
func NewWatcher(cfg WatcherConfig) (*Watcher, error) {
	programID, err := sol.PublicKeyFromBase58(effectiveProgramID())
	if err != nil {
		return nil, fmt.Errorf("invalid program ID: %w", err)
	}

	cfg.RPCEndpoints = NormalizeRPCEndpoints(cfg.RPCEndpoints)
	if len(cfg.RPCEndpoints) == 0 {
		return nil, fmt.Errorf("no RPC endpoints provided")
	}

	rpcClients := make([]*rpc.Client, len(cfg.RPCEndpoints))
	for i, endpoint := range cfg.RPCEndpoints {
		rpcClients[i] = NewRPCClient(endpoint)
	}

	pollInterval := cfg.PollInterval
	if pollInterval == 0 {
		pollInterval = 10 * time.Second
	}

	ctx, cancel := context.WithCancel(context.Background())

	var treasuryID sol.PublicKey
	depositAddrs := make([]sol.PublicKey, 0, 2)
	seen := map[string]struct{}{}
	addAddr := func(raw string) {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return
		}
		if _, ok := seen[raw]; ok {
			return
		}
		pk, err := sol.PublicKeyFromBase58(raw)
		if err != nil {
			log.Printf("[Watcher] Invalid deposit address %q: %v", raw, err)
			return
		}
		seen[raw] = struct{}{}
		depositAddrs = append(depositAddrs, pk)
	}
	addAddr(cfg.TreasuryAddr)
	for _, a := range cfg.DepositAddrs {
		addAddr(a)
	}
	if cfg.TreasuryAddr != "" {
		if pk, err := sol.PublicKeyFromBase58(cfg.TreasuryAddr); err == nil {
			treasuryID = pk
		}
	}

	watcher := &Watcher{
		rpcClients:   rpcClients,
		currentIdx:   0,
		programID:    programID,
		treasuryID:   treasuryID,
		depositAddrs: depositAddrs,
		handlers:     make([]EventHandler, 0),
		pollInterval: pollInterval,
		cursors:      make(map[string]uint64),
		ctx:          ctx,
		cancel:       cancel,
	}

	// Try to connect WebSocket if endpoint provided
	if cfg.WSEndpoint != "" {
		wsClient, err := ws.Connect(ctx, cfg.WSEndpoint)
		if err != nil {
			log.Printf("[Watcher] WebSocket connection failed, falling back to polling: %v", err)
		} else {
			watcher.wsClient = wsClient
			log.Printf("[Watcher] WebSocket connected to %s", cfg.WSEndpoint)
		}
	}

	return watcher, nil
}

// OnEvent registers an event handler
func (w *Watcher) OnEvent(handler EventHandler) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.handlers = append(w.handlers, handler)
}

// Start begins watching for events
func (w *Watcher) Start() {
	w.mu.Lock()
	if w.running {
		w.mu.Unlock()
		return
	}
	w.running = true
	w.mu.Unlock()

	log.Printf("[Watcher] Starting event watcher for program %s", w.programID.String())

	// Start WebSocket subscription if available
	if w.wsClient != nil {
		go w.subscribeToLogs()
	}

	// Start polling as fallback/primary
	go w.pollForTransactions()
}

// Stop stops the watcher
func (w *Watcher) Stop() {
	w.mu.Lock()
	defer w.mu.Unlock()

	if !w.running {
		return
	}

	w.running = false
	w.cancel()

	if w.wsClient != nil {
		w.wsClient.Close()
	}

	log.Printf("[Watcher] Event watcher stopped")
}

// rpc returns the current active RPC client
func (w *Watcher) rpc() *rpc.Client {
	return w.rpcClients[w.currentIdx]
}

// rotateRPC switches to the next available RPC endpoint
func (w *Watcher) rotateRPC() {
	w.currentIdx = (w.currentIdx + 1) % len(w.rpcClients)
}

// withFailover executes an RPC call with automatic failover
func (w *Watcher) withFailover(ctx context.Context, f func(client *rpc.Client) error) error {
	var lastErr error
	for i := 0; i < len(w.rpcClients); i++ {
		err := f(w.rpc())
		if err == nil {
			return nil
		}
		lastErr = err
		if i < len(w.rpcClients)-1 {
			w.rotateRPC()
		}
	}
	return lastErr
}

// subscribeToLogs subscribes to program logs via WebSocket
func (w *Watcher) subscribeToLogs() {
	sub, err := w.wsClient.LogsSubscribeMentions(
		w.programID,
		rpc.CommitmentConfirmed,
	)
	if err != nil {
		log.Printf("[Watcher] Failed to subscribe to logs: %v", err)
		return
	}
	defer sub.Unsubscribe()

	log.Printf("[Watcher] Subscribed to program logs")

	for {
		if w.ctx.Err() != nil {
			return
		}
		// solana-go >=1.17 removed the Response/Err channels; Recv is the API.
		result, err := sub.Recv(w.ctx)
		if err != nil {
			if w.ctx.Err() != nil {
				return
			}
			log.Printf("[Watcher] WebSocket error: %v", err)
			return
		}
		w.processLogResult(result)
	}
}

// processLogResult processes a log result from WebSocket
func (w *Watcher) processLogResult(result *ws.LogResult) {
	if result == nil || result.Value.Logs == nil {
		return
	}

	// Parse logs to detect escrow events
	for _, logLine := range result.Value.Logs {
		event := w.parseLogLine(logLine, result.Value.Signature.String())
		if event != nil {
			w.emitEvent(*event)
		}
	}
}

// parseLogLine attempts to parse an escrow event from a log line (Binary Anchor Events)
func (w *Watcher) parseLogLine(logLine string, txSig string) *EscrowEvent {
	// Anchor logs binary events as: "Program data: <base64>"
	const prefix = "Program data: "
	if len(logLine) <= len(prefix) || logLine[:len(prefix)] != prefix {
		return nil
	}

	data, err := base64.StdEncoding.DecodeString(logLine[len(prefix):])
	if err != nil || len(data) < 8 {
		return nil
	}

	discriminator := data[:8]
	eventData := data[8:]

	// Calculate discriminators for Anchor events
	// Note: Anchor discriminator is sha256("event:<EventName>")[0:8]

	switch fmt.Sprintf("%x", discriminator) {
	case getEventDiscriminator("EscrowInitialized"):
		if len(eventData) < 32+32+32+8+8 {
			return nil
		}
		return &EscrowEvent{
			Type:        "initialized",
			EscrowPDA:   sol.PublicKeyFromBytes(eventData[0:32]).String(),
			Buyer:       sol.PublicKeyFromBytes(eventData[32:64]).String(),
			Seller:      sol.PublicKeyFromBytes(eventData[64:96]).String(),
			Amount:      binary.LittleEndian.Uint64(eventData[96:104]),
			LimitGB:     binary.LittleEndian.Uint64(eventData[104:112]),
			TxSignature: txSig,
			Timestamp:   time.Now(),
		}
	case getEventDiscriminator("EscrowSettled"):
		if len(eventData) < 32+8+8+8 {
			return nil
		}
		return &EscrowEvent{
			Type:        "settled",
			EscrowPDA:   sol.PublicKeyFromBytes(eventData[0:32]).String(),
			Amount:      binary.LittleEndian.Uint64(eventData[32:40]), // seller_payout
			LimitGB:     binary.LittleEndian.Uint64(eventData[48:56]), // bandwidth_used
			TxSignature: txSig,
			Timestamp:   time.Now(),
		}
	case getEventDiscriminator("EscrowRefunded"):
		if len(eventData) < 32+32+8 {
			return nil
		}
		return &EscrowEvent{
			Type:        "refunded",
			EscrowPDA:   sol.PublicKeyFromBytes(eventData[0:32]).String(),
			Buyer:       sol.PublicKeyFromBytes(eventData[32:64]).String(),
			Amount:      binary.LittleEndian.Uint64(eventData[64:72]),
			TxSignature: txSig,
			Timestamp:   time.Now(),
		}
	case getEventDiscriminator("UsageProofSubmitted"):
		// IDL UsageProofSubmitted: escrow(32) proof_record(32) proof_index u32(4)
		// total_bytes u64(8) period_start i64(8) period_end i64(8) = 92 bytes.
		if len(eventData) < 32+32+4+8+8+8 {
			return nil
		}
		return &EscrowEvent{
			Type:        "usage_proof_submitted",
			EscrowPDA:   sol.PublicKeyFromBytes(eventData[0:32]).String(),
			Seller:      sol.PublicKeyFromBytes(eventData[32:64]).String(), // proof_record PDA
			Amount:      binary.LittleEndian.Uint64(eventData[68:76]),      // total_bytes
			TxSignature: txSig,
			Timestamp:   time.Now(),
		}
	case getEventDiscriminator("CircleRegisteredEvent"):
		if len(eventData) < 32+32+4+8 {
			return nil
		}
		// Length of name (u32) is at offset 32+32
		nameLen := binary.LittleEndian.Uint32(eventData[64:68])
		if len(eventData) < 32+32+4+int(nameLen)+1 {
			return nil
		}
		name := string(eventData[68 : 68+nameLen])

		return &EscrowEvent{
			Type:        "circle_registered",
			EscrowPDA:   sol.PublicKeyFromBytes(eventData[0:32]).String(),  // circle_pda
			Buyer:       sol.PublicKeyFromBytes(eventData[32:64]).String(), // leader
			Seller:      name,                                              // Using seller field for extra metadata (name)
			TxSignature: txSig,
			Timestamp:   time.Now(),
		}
	case getEventDiscriminator("CircleSettledEvent"):
		if len(eventData) < 32+32+8+8+8 {
			return nil
		}
		return &EscrowEvent{
			Type:        "circle_settled",
			EscrowPDA:   sol.PublicKeyFromBytes(eventData[0:32]).String(),  // escrow_pda
			Buyer:       sol.PublicKeyFromBytes(eventData[32:64]).String(), // circle_pda
			Amount:      binary.LittleEndian.Uint64(eventData[64:72]),      // seller_payout
			LimitGB:     binary.LittleEndian.Uint64(eventData[80:88]),      // bandwidth_used
			TxSignature: txSig,
			Timestamp:   time.Now(),
		}
	}

	return nil
}

// getEventDiscriminator returns the 8-byte hex discriminator for an Anchor event name
func getEventDiscriminator(eventName string) string {
	h := sha256.New()
	h.Write([]byte(fmt.Sprintf("event:%s", eventName)))
	return fmt.Sprintf("%x", h.Sum(nil)[:8])
}

// pollForTransactions polls for recent transactions to the program
const (
	// W-26: bounded per-address work per poll so a signature burst
	// cannot blow RPC quota or stall the loop; remainder next tick.
	watcherMaxSigsPerPoll = 100
	// Periodic reconciliation re-scan cadence (in poll ticks).
	watcherReconcileEveryTicks = 20
)

func (w *Watcher) monitoredAddresses() []sol.PublicKey {
	addresses := make([]sol.PublicKey, 0, 1+len(w.depositAddrs))
	addresses = append(addresses, w.depositAddrs...)
	if len(w.depositAddrs) == 0 && !w.treasuryID.IsZero() {
		addresses = append(addresses, w.treasuryID)
	}
	if strings.TrimSpace(os.Getenv("PROXYHUB_WATCHER_START_SLOT")) != "0" {
		addresses = append(addresses, w.programID)
	} else if len(addresses) == 0 {
		addresses = append(addresses, w.programID)
	}
	return addresses
}

// loadCursors restores durable per-address watermarks (W-26). Fresh
// addresses start at the current chain slot (no unbounded replay);
// PROXYHUB_WATCHER_START_SLOT=0 still forces replay for ops recovery.
func (w *Watcher) loadCursors(currentSlot uint64) {
	forceReplay := strings.TrimSpace(os.Getenv("PROXYHUB_WATCHER_START_SLOT")) == "0"
	for _, addr := range w.monitoredAddresses() {
		key := addr.String()
		slot := currentSlot
		if forceReplay {
			slot = 0
		} else if db.DB != nil {
			var cur models.WatcherCursor
			if err := db.DB.Where("address = ?", key).First(&cur).Error; err == nil {
				slot = cur.LastSlot
			}
		}
		w.cursors[key] = slot
		if slot > w.lastSlot {
			w.lastSlot = slot
		}
	}
	log.Printf("[Watcher] cursors loaded: %v", w.cursors)
}

func (w *Watcher) persistCursor(address string, slot uint64, sig string) {
	w.cursors[address] = slot
	if slot > w.lastSlot {
		w.lastSlot = slot
	}
	if db.DB == nil {
		return
	}
	row := models.WatcherCursor{Address: address, LastSlot: slot, LastSignature: sig, UpdatedAt: time.Now()}
	if err := db.DB.Save(&row).Error; err != nil {
		log.Printf("[Watcher] persist cursor %s failed: %v", address, err)
	}
}

func (w *Watcher) pollForTransactions() {
	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()

	// Get initial slot with failover
	var slot uint64
	err := w.withFailover(w.ctx, func(client *rpc.Client) error {
		return w.withRetry(func() error {
			s, err := client.GetSlot(w.ctx, rpc.CommitmentFinalized)
			if err != nil {
				return err
			}
			slot = s
			return nil
		}, 3, 1*time.Second)
	})

	if err != nil {
		log.Printf("[Watcher] Initial slot fetch failed after retries: %v. Cursors from DB/0.", err)
	}
	// W-26: resume from durable cursors and backfill immediately -
	// events during downtime are replayed, never skipped.
	w.loadCursors(slot)
	w.checkRecentTransactions()

	for {
		select {
		case <-w.ctx.Done():
			return
		case <-ticker.C:
			w.pollTicks++
			w.checkRecentTransactions()
			if w.pollTicks%watcherReconcileEveryTicks == 0 {
				w.reconcileRecentSignatures()
			}
		}
	}
}

// checkRecentTransactions checks for recent transactions for monitored addresses
func (w *Watcher) checkRecentTransactions() {
	for _, addr := range w.monitoredAddresses() {
		w.scanAddress(addr, false)
	}
}

// reconcileRecentSignatures re-checks the newest signatures per address
// against the durable processed-events log, filling any holes left by
// crashes or WS disconnects (W-26). Dedup makes re-emission impossible.
func (w *Watcher) reconcileRecentSignatures() {
	for _, addr := range w.monitoredAddresses() {
		w.scanAddress(addr, true)
	}
}

// scanAddress processes new signatures for one address in ascending slot
// order, bounded per poll, advancing the durable cursor only past
// successfully fetched transactions.
func (w *Watcher) scanAddress(addr sol.PublicKey, reconcile bool) {
	key := addr.String()
	cursor := w.cursors[key]

	var sigs []*rpc.TransactionSignature
	err := w.withFailover(w.ctx, func(client *rpc.Client) error {
		return w.withRetry(func() error {
			res, err := client.GetSignaturesForAddress(w.ctx, addr)
			if err != nil {
				return err
			}
			sigs = res
			return nil
		}, 2, 500*time.Millisecond)
	})
	if err != nil || len(sigs) == 0 {
		return
	}

	// Ascending slot order so the cursor never jumps over a failure.
	sort.Slice(sigs, func(i, j int) bool { return sigs[i].Slot < sigs[j].Slot })

	processed := 0
	newCursor := cursor
	var lastSig string
	for _, sig := range sigs {
		if !reconcile && sig.Slot <= cursor {
			continue
		}
		if processed >= watcherMaxSigsPerPoll {
			break
		}
		if reconcile && w.eventAlreadyProcessed(sig.Signature.String()) {
			if sig.Slot > newCursor {
				newCursor = sig.Slot
				lastSig = sig.Signature.String()
			}
			continue
		}

		var tx *rpc.GetTransactionResult
		maxVersion := uint64(0)
		err = w.withFailover(w.ctx, func(client *rpc.Client) error {
			var err error
			tx, err = client.GetTransaction(w.ctx, sig.Signature, &rpc.GetTransactionOpts{
				Encoding:                       sol.EncodingBase64,
				MaxSupportedTransactionVersion: &maxVersion,
			})
			return err
		})
		if err != nil {
			log.Printf("[Watcher] GetTransaction failed for %s: %v (cursor held at %d)", sig.Signature.String(), err, newCursor)
			break // retry next poll; do not advance past the hole
		}
		processed++
		if sig.Slot > newCursor {
			newCursor = sig.Slot
			lastSig = sig.Signature.String()
		}
		if event := w.parseTransaction(tx, sig.Signature.String()); event != nil {
			w.emitEvent(*event)
		}
	}
	if newCursor > cursor {
		w.persistCursor(key, newCursor, lastSig)
	}
}

// eventAlreadyProcessed consults the durable dedup log (any event type
// for this signature counts for reconciliation purposes).
func (w *Watcher) eventAlreadyProcessed(txSig string) bool {
	if db.DB == nil || txSig == "" {
		return false
	}
	var count int64
	if err := db.DB.Model(&models.WatcherProcessedEvent{}).Where("tx_signature = ?", txSig).Count(&count).Error; err != nil {
		return false
	}
	return count > 0
}

// parseTransaction extracts escrow events from a transaction
func (w *Watcher) parseTransaction(tx *rpc.GetTransactionResult, txSig string) *EscrowEvent {
	if tx == nil || tx.Meta == nil {
		return nil
	}

	// 1. Try to parse Anchor Events (Escrow/Jury)
	if tx.Meta.LogMessages != nil {
		for _, logLine := range tx.Meta.LogMessages {
			event := w.parseLogLine(logLine, txSig)
			if event != nil {
				return event
			}
		}
	}

	// 2. Check for Direct Native SOL Transfers to Treasury
	if len(w.depositAddrs) > 0 || !w.treasuryID.IsZero() {
		return w.detectNativeTransfer(tx, txSig)
	}

	return nil
}

// detectNativeTransfer identifies if a transaction credited a watched deposit address
func (w *Watcher) detectNativeTransfer(tx *rpc.GetTransactionResult, txSig string) *EscrowEvent {
	// Need at least 2 accounts for a transfer
	decodedTx, err := tx.Transaction.GetTransaction()
	if err != nil {
		return nil
	}

	accountKeys := decodedTx.Message.AccountKeys
	watch := w.depositAddrs
	if len(watch) == 0 && !w.treasuryID.IsZero() {
		watch = []sol.PublicKey{w.treasuryID}
	}

	destIdx := -1
	var destPK sol.PublicKey
	for i, key := range accountKeys {
		for _, watched := range watch {
			if key.Equals(watched) {
				destIdx = i
				destPK = watched
				break
			}
		}
		if destIdx >= 0 {
			break
		}
	}

	if destIdx == -1 {
		return nil
	}

	// Check if destination balance increased
	pre := tx.Meta.PreBalances[destIdx]
	post := tx.Meta.PostBalances[destIdx]
	if post <= pre {
		return nil
	}

	amount := post - pre

	// Identify potential sender (simplification: first account that paid fee or decreased balance)
	sender := ""
	for i, preBal := range tx.Meta.PreBalances {
		// Payer is usually index 0, or any account whose balance decreased
		if preBal > tx.Meta.PostBalances[i] && i != destIdx {
			sender = accountKeys[i].String()
			break
		}
	}

	return &EscrowEvent{
		Type:        "native_deposit",
		Buyer:       sender, // Sender of funds
		Seller:      destPK.String(),
		Amount:      amount,
		TxSignature: txSig,
		Timestamp:   time.Now(),
	}
}

// withRetry executes a function with a specified number of retries and exponential backoff
func (w *Watcher) withRetry(fn func() error, maxRetries int, baseDelay time.Duration) error {
	var lastErr error
	for i := 0; i < maxRetries; i++ {
		if err := fn(); err != nil {
			lastErr = err
			// Check if we should retry (e.g., skip on context cancellation)
			if w.ctx.Err() != nil {
				return err
			}

			delay := baseDelay * (1 << uint(i))
			time.Sleep(delay)
			continue
		}
		return nil
	}
	return lastErr
}

// emitEvent sends an event to all registered handlers
func (w *Watcher) emitEvent(event EscrowEvent) {
	// W-26: durable dedup first (unique insert). The Redis SetNX below
	// remains a fast path, but correctness no longer depends on a
	// 10-minute in-memory TTL surviving restarts/flushes.
	if db.DB != nil && event.TxSignature != "" {
		rec := models.WatcherProcessedEvent{TxSignature: event.TxSignature, EventType: event.Type, ProcessedAt: time.Now()}
		if err := db.DB.Create(&rec).Error; err != nil {
			if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") || strings.Contains(err.Error(), "23505") {
				return // already processed durably
			}
			// Table missing (pre-migration) or transient DB error: log and
			// fall through to Redis dedup rather than dropping the event.
			log.Printf("[Watcher] durable dedup unavailable for tx %s: %v", event.TxSignature, err)
		}
	}
	// Dedup using Redis SetNX to prevent WS + poll double-execution
	if redis.Client != nil && event.TxSignature != "" {
		dedupKey := fmt.Sprintf("watcher:event:%s:%s", event.Type, event.TxSignature)
		ok, err := redis.Client.SetNX(context.Background(), dedupKey, "1", 10*time.Minute).Result()
		if err != nil {
			log.Printf("[Watcher] Redis error checking dedup for tx %s: %v", event.TxSignature, err)
		} else if !ok {
			// Already processed
			return
		}
	}

	w.mu.RLock()
	handlers := make([]EventHandler, len(w.handlers))
	copy(handlers, w.handlers)
	w.mu.RUnlock()

	for _, handler := range handlers {
		go handler(event)
	}

	// Log the event
	eventJSON, _ := json.Marshal(event)
	log.Printf("[Watcher] Event: %s", string(eventJSON))

	// Persist to Block Explorer Tables
	if db.DB != nil {
		explorerTx := models.ExplorerTransaction{
			TxHash:      event.TxSignature,
			Chain:       "solana",
			FromAddress: event.Buyer,
			ToAddress:   event.Seller,
			Amount:      float64(event.Amount) / 1e9,
			Currency:    "SOL",
			Status:      "confirmed",
			TxType:      event.Type,
			Timestamp:   event.Timestamp,
		}

		// Use Upsert logic to avoid duplicates if polling and websocket both catch it
		if err := db.DB.Where(models.ExplorerTransaction{TxHash: event.TxSignature}).
			FirstOrCreate(&explorerTx).Error; err != nil {
			log.Printf("[Watcher] Failed to persist explorer tx: %v", err)
		}
	}
}

// Global watcher instance
var globalWatcher *Watcher

// InitWatcher initializes the global event watcher
func InitWatcher(cfg WatcherConfig) error {
	watcher, err := NewWatcher(cfg)
	if err != nil {
		return err
	}
	globalWatcher = watcher
	return nil
}

// GetWatcher returns the global watcher instance
func GetWatcher() *Watcher {
	return globalWatcher
}

// StartWatcher starts the global watcher
func StartWatcher() {
	if globalWatcher != nil {
		globalWatcher.Start()
	}
}

// StopWatcher stops the global watcher
func StopWatcher() {
	if globalWatcher != nil {
		globalWatcher.Stop()
	}
}
