package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

const (
	explorerWSMaxClientsDefault = 500
	explorerWSMaxPerIPDefault   = 15
	explorerWSMaxPerUserDefault = 5
	explorerWSPollBatchSize     = 50
)

var (
	explorerWSMaxClients = explorerWSMaxClientsDefault
	explorerWSMaxPerIP   = explorerWSMaxPerIPDefault
	explorerWSMaxPerUser = explorerWSMaxPerUserDefault
	explorerWSPending    int32 // handshakes accepted but not yet registered in the hub
)

var (
	explorerWSIPCounts   sync.Map // ip -> *int32
	explorerWSUserCounts sync.Map // user_id -> *int32
)

func init() {
	if v := strings.TrimSpace(os.Getenv("EXPLORER_WS_MAX_CLIENTS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			explorerWSMaxClients = n
		}
	}
	if v := strings.TrimSpace(os.Getenv("EXPLORER_WS_MAX_PER_IP")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			explorerWSMaxPerIP = n
		}
	}
	if v := strings.TrimSpace(os.Getenv("EXPLORER_WS_MAX_PER_USER")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			explorerWSMaxPerUser = n
		}
	}
}

func explorerWSNormalizeIP(ip string) string {
	if ip == "" {
		return "unknown"
	}
	return ip
}

// allowedOrigin returns true when the request origin is acceptable.
// In development (APP_URL not set) all origins are allowed.
func allowedOrigin(r *http.Request) bool {
	appURL := os.Getenv("APP_URL")
	if appURL == "" {
		return true // development mode — no restriction
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // non-browser clients
	}
	// Normalise: strip trailing slash, lowercase
	normalise := func(s string) string { return strings.TrimRight(strings.ToLower(s), "/") }
	return normalise(origin) == normalise(appURL)
}

var explorerUpgrader = websocket.Upgrader{
	CheckOrigin:     allowedOrigin,
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// ExplorerHub manages WebSocket connections for explorer updates
type ExplorerHub struct {
	clients    map[*websocket.Conn]bool
	broadcast  chan ExplorerUpdate
	register   chan *clientEntry
	unregister chan *websocket.Conn
	mu         sync.RWMutex
}

// ExplorerUpdate represents a real-time update to explorer clients
type ExplorerUpdate struct {
	Type      string      `json:"type"`
	Data      interface{} `json:"data"`
	Timestamp time.Time   `json:"timestamp"`
}

// NewTransactionUpdate represents a new transaction update
type NewTransactionUpdate struct {
	TxHash   string  `json:"tx_hash"`
	From     string  `json:"from"`
	To       string  `json:"to"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
	TxType   string  `json:"tx_type"`
}

// NewBlockUpdate represents a new block update
type NewBlockUpdate struct {
	BlockNumber      uint64 `json:"block_number"`
	BlockHash        string `json:"block_hash"`
	TransactionCount int    `json:"transaction_count"`
}

// NodeUpdate represents a node status update — includes geo so the map can
// move or recolour a marker without a full re-fetch.
type NodeUpdate struct {
	NodeID         string  `json:"node_id"`
	IsActive       bool    `json:"is_active"`
	UptimePercent  float64 `json:"uptime_percent"`
	ActiveSessions int     `json:"active_sessions"`
	Latitude       float64 `json:"lat"`
	Longitude      float64 `json:"lon"`
}

// LinkTopologyUpdate signals that map_node_links changed; clients should refetch GET /v1/map/links.
type LinkTopologyUpdate struct {
	Action             string `json:"action"`
	LinkCount          int    `json:"link_count"`
	TopologyAvailable  bool   `json:"topology_available"`
}

// clientEntry holds a connection alongside the topics it subscribed to.
// An empty topics map means "all topics" (backwards-compatible default).
type clientEntry struct {
	conn     *websocket.Conn
	clientIP string
	userID   string          // empty if anonymous
	topics   map[string]bool // nil = subscribe to everything
}

// subscribeMsg is the optional JSON message a client can send on connect
// to limit which update types it receives.
//
//	{ "type": "subscribe", "topics": ["nodes"] }
type subscribeMsg struct {
	Type   string   `json:"type"`
	Topics []string `json:"topics"`
}

var hub *ExplorerHub

// explorerWSReserveIP atomically reserves a per-IP slot (EXP-P0-11).
func explorerWSReserveIP(ip string) bool {
	ip = explorerWSNormalizeIP(ip)
	val, _ := explorerWSIPCounts.LoadOrStore(ip, new(int32))
	count := val.(*int32)
	for {
		n := atomic.LoadInt32(count)
		if n >= int32(explorerWSMaxPerIP) {
			return false
		}
		if atomic.CompareAndSwapInt32(count, n, n+1) {
			return true
		}
	}
}

func explorerWSReleaseIP(ip string) {
	ip = explorerWSNormalizeIP(ip)
	if val, ok := explorerWSIPCounts.Load(ip); ok {
		n := atomic.AddInt32(val.(*int32), -1)
		if n < 0 {
			atomic.StoreInt32(val.(*int32), 0)
		}
	}
}

// explorerWSReserveUser atomically reserves a per-user connection slot.
func explorerWSReserveUser(userID string) bool {
	if userID == "" {
		return true // anonymous connection
	}
	val, _ := explorerWSUserCounts.LoadOrStore(userID, new(int32))
	count := val.(*int32)
	for {
		n := atomic.LoadInt32(count)
		if n >= int32(explorerWSMaxPerUser) {
			return false
		}
		if atomic.CompareAndSwapInt32(count, n, n+1) {
			return true
		}
	}
}

// explorerWSReleaseUser releases a user slot.
func explorerWSReleaseUser(userID string) {
	if userID == "" {
		return
	}
	if val, ok := explorerWSUserCounts.Load(userID); ok {
		n := atomic.AddInt32(val.(*int32), -1)
		if n < 0 {
			atomic.StoreInt32(val.(*int32), 0)
		}
	}
}

// tryAcceptExplorerWSConnection enforces global, per-IP, and per-user connection caps before upgrade.
func (h *ExplorerHub) tryAcceptExplorerWSConnection(ip string, userID string) bool {
	if !explorerWSReserveIP(ip) {
		return false
	}
	if userID != "" && !explorerWSReserveUser(userID) {
		explorerWSReleaseIP(ip)
		return false
	}

	pending := atomic.AddInt32(&explorerWSPending, 1)
	h.mu.RLock()
	atCapacity := len(h.clients)+int(pending) > explorerWSMaxClients
	h.mu.RUnlock()
	if atCapacity {
		atomic.AddInt32(&explorerWSPending, -1)
		explorerWSReleaseIP(ip)
		if userID != "" {
			explorerWSReleaseUser(userID)
		}
		return false
	}
	return true
}

func explorerWSReleasePendingHandshake() {
	if n := atomic.AddInt32(&explorerWSPending, -1); n < 0 {
		atomic.StoreInt32(&explorerWSPending, 0)
	}
}

// InitExplorerHub initializes the explorer WebSocket hub
func InitExplorerHub() *ExplorerHub {
	hub = &ExplorerHub{
		clients:    make(map[*websocket.Conn]bool),
		broadcast:  make(chan ExplorerUpdate, 256),
		register:   make(chan *clientEntry),
		unregister: make(chan *websocket.Conn),
	}

	go hub.run()
	go hub.startPolling()

	return hub
}

// entries is the authoritative set of connected clients with their topic
// subscriptions. It is only accessed from the run() goroutine so no extra
// lock is needed for the map itself (the outer mu still guards concurrent
// reads from outside).
var entries = make(map[*websocket.Conn]*clientEntry)

// run handles client registration/unregistration and broadcasting
func (h *ExplorerHub) run() {
	for {
		select {
		case entry := <-h.register:
			explorerWSReleasePendingHandshake()
			h.mu.Lock()
			h.clients[entry.conn] = true
			entries[entry.conn] = entry
			if entry.topics == nil {
				entry.topics = nil // all topics
			}
			h.mu.Unlock()
			logging.Debug().Str("ip", entry.clientIP).Msg("[ExplorerHub] Client connected")
			h.sendInitialData(entry.conn)

		case client := <-h.unregister:
			h.mu.Lock()
			if entry, ok := entries[client]; ok {
				explorerWSReleaseIP(entry.clientIP)
				if entry.userID != "" {
					explorerWSReleaseUser(entry.userID)
				}
			}
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				delete(entries, client)
				client.Close()
			}
			h.mu.Unlock()
			logging.Debug().Msg("[ExplorerHub] Client disconnected")

		case update := <-h.broadcast:
			data, _ := json.Marshal(update)

			// P1-02/03: collect dead connections under RLock, then remove
			// under WLock — avoids lock-upgrade deadlock and map mutation
			// while iterating.
			var dead []*websocket.Conn
			h.mu.RLock()
			for conn, entry := range entries {
				if entry.topics != nil && !entry.topics[update.Type] {
					continue
				}
				// Use a write deadline so slow clients don't block the loop.
				_ = conn.SetWriteDeadline(time.Now().Add(500 * time.Millisecond))
				if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
					dead = append(dead, conn)
				} else {
					_ = conn.SetWriteDeadline(time.Time{}) // clear deadline on success
				}
			}
			h.mu.RUnlock()

			if len(dead) > 0 {
				logging.Warn().
					Int("dropped_clients", len(dead)).
					Str("update_type", update.Type).
					Msg("[ExplorerHub] dropped slow WebSocket clients during broadcast")
				h.mu.Lock()
				for _, conn := range dead {
					if entry, ok := entries[conn]; ok {
						explorerWSReleaseIP(entry.clientIP)
						if entry.userID != "" {
							explorerWSReleaseUser(entry.userID)
						}
					}
					delete(h.clients, conn)
					delete(entries, conn)
					conn.Close()
				}
				h.mu.Unlock()
			}
		}
	}
}

// sendInitialData sends initial explorer data to a newly connected client.
// Sends recent transactions, blocks, and active nodes so the frontend dashboard
// can populate immediately without waiting for the 5-second polling cycle.
func (h *ExplorerHub) sendInitialData(client *websocket.Conn) {
	// Recent transactions
	var transactions []models.ExplorerTransaction
	db.DB.Where("is_orphaned = ?", false).Order("timestamp DESC").Limit(10).Find(&transactions)

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

	// Recent blocks
	var blocks []models.ExplorerBlock
	db.DB.Where("is_orphaned = ?", false).Order("block_number DESC").Limit(5).Find(&blocks)

	blockUpdates := make([]NewBlockUpdate, len(blocks))
	for i, b := range blocks {
		blockUpdates[i] = NewBlockUpdate{
			BlockNumber:      b.BlockNumber,
			BlockHash:        b.BlockHash,
			TransactionCount: b.TransactionCount,
		}
	}

	// Active nodes (for map initialization)
	var nodes []models.ExplorerNode
	db.DB.Where("is_active = ?", true).
		Select("node_id, latitude, longitude, is_active, is_validator, uptime_percent, active_sessions, country, region, city, isp").
		Order("uptime_percent DESC").
		Limit(100).
		Find(&nodes)

	nodeUpdates := make([]NodeUpdate, len(nodes))
	for i, n := range nodes {
		nodeUpdates[i] = NodeUpdate{
			NodeID:         n.NodeID,
			IsActive:       n.IsActive,
			UptimePercent:  n.UptimePercent,
			ActiveSessions: n.ActiveSessions,
			Latitude:       n.Latitude,
			Longitude:      n.Longitude,
		}
	}

	type InitialPayload struct {
		Transactions []NewTransactionUpdate `json:"transactions"`
		Blocks       []NewBlockUpdate       `json:"blocks"`
		Nodes        []NodeUpdate           `json:"nodes"`
	}

	initialData := ExplorerUpdate{
		Type: "initial",
		Data: InitialPayload{
			Transactions: txUpdates,
			Blocks:       blockUpdates,
			Nodes:        nodeUpdates,
		},
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
	var lastTxID uuid.UUID
	var lastBlockNumber uint64

	var latestTx models.ExplorerTransaction
	if err := db.DB.Where("is_orphaned = ?", false).Order("timestamp DESC, id DESC").First(&latestTx).Error; err == nil {
		lastTxTime = latestTx.Timestamp
		lastTxID = latestTx.ID
	}
	var latestBlock models.ExplorerBlock
	if err := db.DB.Where("is_orphaned = ?", false).Order("block_number DESC").First(&latestBlock).Error; err == nil {
		lastBlockNumber = latestBlock.BlockNumber
	}

	for range ticker.C {
		// Check for new transactions (EXP-P0-13: cursor from DB, strict > on time+id).
		var newTransactions []models.ExplorerTransaction
		query := db.DB.Where("is_orphaned = ?", false).Order("timestamp ASC, id ASC").Limit(explorerWSPollBatchSize)
		if !lastTxTime.IsZero() {
			query = query.Where("(timestamp > ?) OR (timestamp = ? AND id > ?)", lastTxTime, lastTxTime, lastTxID)
		}
		query.Find(&newTransactions)

		for _, tx := range newTransactions {
			lastTxTime = tx.Timestamp
			lastTxID = tx.ID

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
				logging.Warn().Str("type", update.Type).Msg("[ExplorerHub] broadcast channel full, dropped update")
			}
		}

		// Check for new blocks
		var latestBlock models.ExplorerBlock
		if err := db.DB.Where("is_orphaned = ?", false).Order("block_number DESC").First(&latestBlock).Error; err == nil {
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
					logging.Warn().Str("type", update.Type).Msg("[ExplorerHub] broadcast channel full, dropped update")
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
	if !allowExplorerWebSocket(c) {
		return
	}

	if hub == nil {
		InitExplorerHub()
	}

	var userIDStr string
	if uid, exists := c.Get("user_id"); exists {
		if parsedUUID, ok := uid.(uuid.UUID); ok {
			userIDStr = parsedUUID.String()
		} else if parsedStr, ok := uid.(string); ok {
			userIDStr = parsedStr
		}
	}

	clientIP := c.ClientIP()
	if !hub.tryAcceptExplorerWSConnection(clientIP, userIDStr) {
		c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
			"error": "too_many_websocket_connections",
		})
		return
	}

	conn, err := explorerUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		explorerWSReleasePendingHandshake()
		explorerWSReleaseIP(clientIP)
		if userIDStr != "" {
			explorerWSReleaseUser(userIDStr)
		}
		logging.Error(err).Msg("[ExplorerHub] Failed to upgrade WebSocket")
		return
	}

	hub.register <- &clientEntry{conn: conn, clientIP: clientIP, userID: userIDStr, topics: nil}

	// Keep connection alive and handle optional subscription messages from client
	go func() {
		defer func() {
			hub.unregister <- conn
		}()

		// Reset read deadline on every pong so idle connections survive up to 70s.
		conn.SetReadDeadline(time.Now().Add(70 * time.Second))
		conn.SetPongHandler(func(string) error {
			conn.SetReadDeadline(time.Now().Add(70 * time.Second))
			return nil
		})

		// Ping goroutine — send a WebSocket-level ping every 30s.
		pingTicker := time.NewTicker(30 * time.Second)
		defer pingTicker.Stop()
		go func() {
			for range pingTicker.C {
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
					return
				}
			}
		}()

		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					logging.Error(err).Msg("[ExplorerHub] WebSocket error")
				}
				break
			}

			// Handle { "type": "subscribe", "topics": ["nodes", "transactions"] }
			var sub subscribeMsg
			if jsonErr := json.Unmarshal(msg, &sub); jsonErr == nil && sub.Type == "subscribe" && len(sub.Topics) > 0 {
				topicSet := make(map[string]bool, len(sub.Topics))
				for _, t := range sub.Topics {
					topicSet[t] = true
				}
				// map page topics → WS update types
				topicMap := map[string][]string{
					"nodes":        {"node_update"},
					"links":        {"link_update"},
					"transactions": {"new_transaction"},
					"blocks":       {"new_block"},
					"all":          {"node_update", "link_update", "new_transaction", "new_block", "initial"},
				}
				resolved := make(map[string]bool)
				for _, t := range sub.Topics {
					if types, ok := topicMap[t]; ok {
						for _, ut := range types {
							resolved[ut] = true
						}
					} else {
						resolved[t] = true // pass through unknown types verbatim
					}
				}
				hub.mu.Lock()
				if entry, ok := entries[conn]; ok {
					entry.topics = resolved
				}
				hub.mu.Unlock()
				logging.Debug().Msgf("[ExplorerHub] Client subscribed to %v", sub.Topics)
			}
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

// NotifyNodeUpdate notifies all clients about a node status change.
// Lat/Lon are included so the map can reposition or create a marker
// without a separate API call.
func NotifyNodeUpdate(node *models.ExplorerNode) {
	if hub == nil {
		return
	}

	hub.BroadcastUpdate("node_update", NodeUpdate{
		NodeID:         node.NodeID,
		IsActive:       node.IsActive,
		UptimePercent:  node.UptimePercent,
		ActiveSessions: node.ActiveSessions,
		Latitude:       node.Latitude,
		Longitude:      node.Longitude,
	})
}

// NotifyLinkTopologyUpdate broadcasts a lightweight refresh hint after link aggregation.
func NotifyLinkTopologyUpdate(linkCount int, topologyAvailable bool) {
	if hub == nil {
		return
	}
	hub.BroadcastUpdate("link_update", LinkTopologyUpdate{
		Action:            "refresh",
		LinkCount:         linkCount,
		TopologyAvailable: topologyAvailable,
	})
}
