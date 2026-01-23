// Package solana - Event watcher for on-chain escrow creation
package solana

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
	"github.com/gagliardetto/solana-go/rpc/ws"
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
	rpcClient    *rpc.Client
	wsClient     *ws.Client
	programID    sol.PublicKey
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
	RPCEndpoint  string
	WSEndpoint   string // Optional WebSocket endpoint
	PollInterval time.Duration
}

// NewWatcher creates a new event watcher
func NewWatcher(cfg WatcherConfig) (*Watcher, error) {
	programID, err := sol.PublicKeyFromBase58(ProgramID)
	if err != nil {
		return nil, fmt.Errorf("invalid program ID: %w", err)
	}

	rpcClient := rpc.New(cfg.RPCEndpoint)

	pollInterval := cfg.PollInterval
	if pollInterval == 0 {
		pollInterval = 10 * time.Second
	}

	ctx, cancel := context.WithCancel(context.Background())

	watcher := &Watcher{
		rpcClient:    rpcClient,
		programID:    programID,
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

// parseLogLine attempts to parse an escrow event from a log line
func (w *Watcher) parseLogLine(logLine string, txSig string) *EscrowEvent {
	// Anchor logs escrow initialization as: "Program log: Escrow initialized: X lamports for Y GB"
	if len(logLine) > 50 && logLine[:12] == "Program log:" {
		msg := logLine[13:]

		// Check for escrow initialized
		if len(msg) > 20 && msg[:18] == "Escrow initialized:" {
			event := &EscrowEvent{
				Type:        "initialized",
				TxSignature: txSig,
				Timestamp:   time.Now(),
			}
			// Parse amount and limit from log (simplified)
			return event
		}

		// Check for escrow settled
		if len(msg) > 15 && msg[:14] == "Escrow settled:" {
			return &EscrowEvent{
				Type:        "settled",
				TxSignature: txSig,
				Timestamp:   time.Now(),
			}
		}

		// Check for escrow refunded
		if len(msg) > 16 && msg[:15] == "Escrow refunded:" {
			return &EscrowEvent{
				Type:        "refunded",
				TxSignature: txSig,
				Timestamp:   time.Now(),
			}
		}
	}

	return nil
}

// pollForTransactions polls for recent transactions to the program
func (w *Watcher) pollForTransactions() {
	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()

	// Get initial slot with retry
	var slot uint64
	var err error

	err = w.withRetry(func() error {
		s, err := w.rpcClient.GetSlot(w.ctx, rpc.CommitmentFinalized)
		if err != nil {
			return err
		}
		slot = s
		return nil
	}, 3, 1*time.Second)

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

// checkRecentTransactions checks for recent program transactions
func (w *Watcher) checkRecentTransactions() {
	// Get recent signatures for the program with retry
	var sigs []*rpc.TransactionSignature
	err := w.withRetry(func() error {
		res, err := w.rpcClient.GetSignaturesForAddress(
			w.ctx,
			w.programID,
		)
		if err != nil {
			return err
		}
		sigs = res
		return nil
	}, 3, 500*time.Millisecond)

	if err != nil {
		// Log as warning since it might be transient
		log.Printf("[Watcher] RPC Error (GetSignaturesForAddress): %v", err)
		return
	}

	if len(sigs) == 0 {
		return
	}

	// Process only new transactions
	for _, sig := range sigs {
		if sig.Slot <= w.lastSlot {
			continue
		}

		// Fetch transaction details
		tx, err := w.rpcClient.GetTransaction(
			w.ctx,
			sig.Signature,
			&rpc.GetTransactionOpts{
				Encoding: sol.EncodingBase64,
			},
		)
		if err != nil {
			continue
		}

		// Parse transaction for escrow events
		event := w.parseTransaction(tx, sig.Signature.String())
		if event != nil {
			w.emitEvent(*event)
		}
	}

	// Update last slot
	if len(sigs) > 0 {
		w.lastSlot = sigs[0].Slot
	}
}

// parseTransaction extracts escrow events from a transaction
func (w *Watcher) parseTransaction(tx *rpc.GetTransactionResult, txSig string) *EscrowEvent {
	if tx == nil || tx.Meta == nil || tx.Meta.LogMessages == nil {
		return nil
	}

	for _, logLine := range tx.Meta.LogMessages {
		event := w.parseLogLine(logLine, txSig)
		if event != nil {
			return event
		}
	}

	return nil
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
