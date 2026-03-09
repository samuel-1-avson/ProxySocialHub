package api

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

var explorerUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// In production, implement proper origin checking
		return true
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// ExplorerHub manages WebSocket connections for explorer updates
type ExplorerHub struct {
	clients    map[*websocket.Conn]bool
	broadcast  chan ExplorerUpdate
	register   chan *websocket.Conn
	unregister chan *websocket.Conn
	mu         sync.RWMutex
}

// ExplorerUpdate represents a real-time update to explorer clients
type ExplorerUpdate struct {
	Type        string      `json:"type"`
	Data        interface{} `json:"data"`
	Timestamp   time.Time   `json:"timestamp"`
}

// NewTransactionUpdate represents a new transaction update
type NewTransactionUpdate struct {
	TxHash    string  `json:"tx_hash"`
	From      string  `json:"from"`
	To        string  `json:"to"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
	TxType    string  `json:"tx_type"`
}

// NewBlockUpdate represents a new block update
type NewBlockUpdate struct {
	BlockNumber      uint64 `json:"block_number"`
	BlockHash        string `json:"block_hash"`
	TransactionCount int    `json:"transaction_count"`
}

// NodeUpdate represents a node status update
type NodeUpdate struct {
	NodeID         string  `json:"node_id"`
	IsActive       bool    `json:"is_active"`
	UptimePercent  float64 `json:"uptime_percent"`
	ActiveSessions int     `json:"active_sessions"`
}

var hub *ExplorerHub

// InitExplorerHub initializes the explorer WebSocket hub
func InitExplorerHub() *ExplorerHub {
	hub = &ExplorerHub{
		clients:    make(map[*websocket.Conn]bool),
		broadcast:  make(chan ExplorerUpdate, 256),
		register:   make(chan *websocket.Conn),
		unregister: make(chan *websocket.Conn),
	}

	go hub.run()
	go hub.startPolling()

	return hub
}

// run handles client registration/unregistration and broadcasting
func (h *ExplorerHub) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			logging.Debug().Msg("[ExplorerHub] Client connected")

			// Send initial data
			h.sendInitialData(client)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				client.Close()
			}
			h.mu.Unlock()
			logging.Debug().Msg("[ExplorerHub] Client disconnected")

		case update := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case <-time.After(100 * time.Millisecond):
					// Timeout - skip slow clients
				default:
					data, _ := json.Marshal(update)
					if err := client.WriteMessage(websocket.TextMessage, data); err != nil {
						// Client disconnected
						h.mu.RUnlock()
						h.mu.Lock()
						delete(h.clients, client)
						client.Close()
						h.mu.Unlock()
						h.mu.RLock()
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

// sendInitialData sends initial explorer data to a newly connected client
func (h *ExplorerHub) sendInitialData(client *websocket.Conn) {
	// Send recent transactions
	var transactions []models.ExplorerTransaction
	db.DB.Order("timestamp DESC").Limit(10).Find(&transactions)

	txUpdates := make([]NewTransactionUpdate, len(transactions))
	for i, tx := range transactions {
		txUpdates[i] = NewTransactionUpdate{
			TxHash:   tx.TxHash,
			From:     tx.FromAddress,
			To:       tx.ToAddress,
			Amount:   tx.Amount,
			Currency: tx.Currency,
			TxType:   tx.TxType,
		}
	}

	initialData := ExplorerUpdate{
		Type:      "initial",
		Data:      txUpdates,
		Timestamp: time.Now(),
	}

	data, _ := json.Marshal(initialData)
	client.WriteMessage(websocket.TextMessage, data)
}

// startPolling polls the database for updates and broadcasts them
func (h *ExplorerHub) startPolling() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	var lastTxTime time.Time
	var lastBlockNumber uint64

	for range ticker.C {
		// Check for new transactions
		var newTransactions []models.ExplorerTransaction
		query := db.DB.Order("timestamp DESC").Limit(5)
		if !lastTxTime.IsZero() {
			query = query.Where("timestamp > ?", lastTxTime)
		}
		query.Find(&newTransactions)

		for _, tx := range newTransactions {
			if tx.Timestamp.After(lastTxTime) {
				lastTxTime = tx.Timestamp
			}

			update := ExplorerUpdate{
				Type: "new_transaction",
				Data: NewTransactionUpdate{
					TxHash:   tx.TxHash,
					From:     tx.FromAddress,
					To:       tx.ToAddress,
					Amount:   tx.Amount,
					Currency: tx.Currency,
					TxType:   tx.TxType,
				},
				Timestamp: time.Now(),
			}
			select {
			case h.broadcast <- update:
			default:
				// Channel full, drop update
			}
		}

		// Check for new blocks
		var latestBlock models.ExplorerBlock
		if err := db.DB.Order("block_number DESC").First(&latestBlock).Error; err == nil {
			if latestBlock.BlockNumber > lastBlockNumber {
				lastBlockNumber = latestBlock.BlockNumber

				update := ExplorerUpdate{
					Type: "new_block",
					Data: NewBlockUpdate{
						BlockNumber:      latestBlock.BlockNumber,
						BlockHash:        latestBlock.BlockHash,
						TransactionCount: latestBlock.TransactionCount,
					},
					Timestamp: time.Now(),
				}
				select {
				case h.broadcast <- update:
				default:
				}
			}
		}
	}
}

// BroadcastUpdate broadcasts an update to all connected clients
func (h *ExplorerHub) BroadcastUpdate(updateType string, data interface{}) {
	update := ExplorerUpdate{
		Type:      updateType,
		Data:      data,
		Timestamp: time.Now(),
	}
	select {
	case h.broadcast <- update:
	default:
		// Channel full
	}
}

// GetExplorerHub returns the global explorer hub instance
func GetExplorerHub() *ExplorerHub {
	return hub
}

// RegisterExplorerWSRoutes registers WebSocket routes for the explorer
func RegisterExplorerWSRoutes(r *gin.RouterGroup) {
	ws := r.Group("/explorer/ws")
	{
		ws.GET("", handleExplorerWebSocket)
	}
}

// handleExplorerWebSocket handles WebSocket connections
func handleExplorerWebSocket(c *gin.Context) {
	conn, err := explorerUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		logging.Error(err).Msg("[ExplorerHub] Failed to upgrade WebSocket")
		return
	}

	if hub == nil {
		InitExplorerHub()
	}

	hub.register <- conn

	// Keep connection alive and handle client messages
	go func() {
		defer func() {
			hub.unregister <- conn
		}()

		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					logging.Error(err).Msg("[ExplorerHub] WebSocket error")
				}
				break
			}
			// We could handle client messages here (e.g., subscription requests)
		}
	}()
}

// NotifyNewTransaction notifies all clients about a new transaction
func NotifyNewTransaction(tx *models.ExplorerTransaction) {
	if hub == nil {
		return
	}

	hub.BroadcastUpdate("new_transaction", NewTransactionUpdate{
		TxHash:   tx.TxHash,
		From:     tx.FromAddress,
		To:       tx.ToAddress,
		Amount:   tx.Amount,
		Currency: tx.Currency,
		TxType:   tx.TxType,
	})
}

// NotifyNewBlock notifies all clients about a new block
func NotifyNewBlock(block *models.ExplorerBlock) {
	if hub == nil {
		return
	}

	hub.BroadcastUpdate("new_block", NewBlockUpdate{
		BlockNumber:      block.BlockNumber,
		BlockHash:        block.BlockHash,
		TransactionCount: block.TransactionCount,
	})
}

// NotifyNodeUpdate notifies all clients about a node status change
func NotifyNodeUpdate(node *models.ExplorerNode) {
	if hub == nil {
		return
	}

	hub.BroadcastUpdate("node_update", NodeUpdate{
		NodeID:         node.NodeID,
		IsActive:       node.IsActive,
		UptimePercent:  node.UptimePercent,
		ActiveSessions: node.ActiveSessions,
	})
}
