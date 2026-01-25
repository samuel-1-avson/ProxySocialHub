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
	"sync"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
	"github.com/gagliardetto/solana-go/rpc/ws"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
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
	rpcClients   []*rpc.Client
	currentIdx   int
	wsClient     *ws.Client
	programID    sol.PublicKey
	treasuryID   sol.PublicKey // Address to monitor for direct deposits
	handlers     []EventHandler
	pollInterval time.Duration
	lastSlot     uint64
	running      bool
	mu           sync.RWMutex
	ctx          context.Context
	cancel       context.CancelFunc
}

// WatcherConfig holds configuration for the event watcher
type WatcherConfig struct {
	RPCEndpoints []string
	WSEndpoint   string // Optional WebSocket endpoint
	TreasuryAddr string // Optional treasury address to monitor
	PollInterval time.Duration
}

// NewWatcher creates a new event watcher
func NewWatcher(cfg WatcherConfig) (*Watcher, error) {
	programID, err := sol.PublicKeyFromBase58(ProgramID)
	if err != nil {
		return nil, fmt.Errorf("invalid program ID: %w", err)
	}

	if len(cfg.RPCEndpoints) == 0 {
		return nil, fmt.Errorf("no RPC endpoints provided")
	}

	rpcClients := make([]*rpc.Client, len(cfg.RPCEndpoints))
	for i, endpoint := range cfg.RPCEndpoints {
		rpcClients[i] = rpc.New(endpoint)
	}

	pollInterval := cfg.PollInterval
	if pollInterval == 0 {
		pollInterval = 10 * time.Second
	}

	ctx, cancel := context.WithCancel(context.Background())

	var treasuryID sol.PublicKey
	if cfg.TreasuryAddr != "" {
		treasuryID, err = sol.PublicKeyFromBase58(cfg.TreasuryAddr)
		if err != nil {
			log.Printf("[Watcher] Invalid treasury address: %v", err)
		}
	}

	watcher := &Watcher{
		rpcClients:   rpcClients,
		currentIdx:   0,
		programID:    programID,
		treasuryID:   treasuryID,
		handlers:     make([]EventHandler, 0),
		pollInterval: pollInterval,
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
		select {
		case <-w.ctx.Done():
			return
		case result, ok := <-sub.Response():
			if !ok {
				log.Printf("[Watcher] WebSocket subscription closed")
				return
			}
			w.processLogResult(result)
		case err := <-sub.Err():
			log.Printf("[Watcher] WebSocket error: %v", err)
			return
		}
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
	case getEventDiscriminator("EscrowInitializedEvent"):
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
	case getEventDiscriminator("EscrowSettledEvent"):
		if len(eventData) < 32+8+8+8 {
			return nil
		}
		return &EscrowEvent{
			Type:        "settled",
			EscrowPDA:   sol.PublicKeyFromBytes(eventData[0:32]).String(),
			TxSignature: txSig,
			Timestamp:   time.Now(),
		}
	case getEventDiscriminator("EscrowRefundedEvent"):
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
		if len(eventData) < 32+32+32+8+8+8+8 {
			return nil
		}
		return &EscrowEvent{
			Type:        "usage_proof_submitted",
			EscrowPDA:   sol.PublicKeyFromBytes(eventData[0:32]).String(),
			Buyer:       sol.PublicKeyFromBytes(eventData[32:64]).String(),
			Seller:      sol.PublicKeyFromBytes(eventData[64:96]).String(),
			Amount:      binary.LittleEndian.Uint64(eventData[96:104]), // total_bytes
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

	if err == nil {
		w.lastSlot = slot
	} else {
		log.Printf("[Watcher] Initial slot fetch failed after retries: %v. Starting from 0.", err)
	}

	for {
		select {
		case <-w.ctx.Done():
			return
		case <-ticker.C:
			w.checkRecentTransactions()
		}
	}
}

// checkRecentTransactions checks for recent transactions for monitored addresses
func (w *Watcher) checkRecentTransactions() {
	addresses := []sol.PublicKey{w.programID}
	if !w.treasuryID.IsZero() {
		addresses = append(addresses, w.treasuryID)
	}

	for _, addr := range addresses {
		// Get recent signatures for the address with failover
		var sigs []*rpc.TransactionSignature
		err := w.withFailover(w.ctx, func(client *rpc.Client) error {
			return w.withRetry(func() error {
				res, err := client.GetSignaturesForAddress(
					w.ctx,
					addr,
				)
				if err != nil {
					return err
				}
				sigs = res
				return nil
			}, 2, 500*time.Millisecond) // Lower retry for frequent polling
		})

		if err != nil {
			continue
		}

		if len(sigs) == 0 {
			continue
		}

		// Process only new transactions
		for _, sig := range sigs {
			if sig.Slot <= w.lastSlot {
				continue
			}

			// Fetch transaction details with failover
			var tx *rpc.GetTransactionResult
			err = w.withFailover(w.ctx, func(client *rpc.Client) error {
				var err error
				tx, err = client.GetTransaction(
					w.ctx,
					sig.Signature,
					&rpc.GetTransactionOpts{
						Encoding: sol.EncodingBase64,
					},
				)
				return err
			})
			if err != nil {
				continue
			}

			// Parse transaction for escrow events OR native transfers
			event := w.parseTransaction(tx, sig.Signature.String())
			if event != nil {
				w.emitEvent(*event)
			}
		}
	}

	// Update last slot based on first address (usually programID)
	// In a real system we'd track lastSlot per address, but for simplicity we use one global
	// since slots are sequential for the whole chain.
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
	if !w.treasuryID.IsZero() {
		return w.detectNativeTransfer(tx, txSig)
	}

	return nil
}

// detectNativeTransfer identifies if a transaction credited the treasury and returns a virtual event
func (w *Watcher) detectNativeTransfer(tx *rpc.GetTransactionResult, txSig string) *EscrowEvent {
	// Need at least 2 accounts for a transfer
	decodedTx, err := tx.Transaction.GetTransaction()
	if err != nil {
		return nil
	}

	accountKeys := decodedTx.Message.AccountKeys
	treasuryIdx := -1
	for i, key := range accountKeys {
		if key.Equals(w.treasuryID) {
			treasuryIdx = i
			break
		}
	}

	if treasuryIdx == -1 {
		return nil
	}

	// Check if treasury balance increased
	pre := tx.Meta.PreBalances[treasuryIdx]
	post := tx.Meta.PostBalances[treasuryIdx]
	if post <= pre {
		return nil
	}

	amount := post - pre

	// Identify potential sender (simplification: first account that paid fee or decreased balance)
	sender := ""
	for i, preBal := range tx.Meta.PreBalances {
		// Payer is usually index 0, or any account whose balance decreased
		if preBal > tx.Meta.PostBalances[i] && i != treasuryIdx {
			sender = accountKeys[i].String()
			break
		}
	}

	return &EscrowEvent{
		Type:        "native_deposit",
		Buyer:       sender, // Sender of funds
		Seller:      w.treasuryID.String(),
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
