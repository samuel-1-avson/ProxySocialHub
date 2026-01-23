package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// ========== WebSocket Hub ==========

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// Allow connections from allowed origins
		origin := r.Header.Get("Origin")
		allowedOrigins := []string{
			"http://localhost:3000",
			"http://localhost:3001",
			"https://proxyhubb.com",
			"https://app.proxyhubb.com",
		}
		for _, allowed := range allowedOrigins {
			if origin == allowed {
				return true
			}
		}
		return false
	},
}

// Client represents a WebSocket client
type Client struct {
	ID     string
	UserID string
	Role   string
	Conn   *websocket.Conn
	Send   chan []byte
	Hub    *Hub
}

// Hub manages all WebSocket connections
type Hub struct {
	clients    map[string]*Client
	broadcast  chan *Message
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

// Message represents a WebSocket message
type Message struct {
	Type      string      `json:"type"`
	Target    string      `json:"target,omitempty"` // user ID or "all"
	Data      interface{} `json:"data"`
	Timestamp int64       `json:"timestamp"`
}

// Message types
const (
	MsgTypeSessionUpdate  = "session_update"
	MsgTypeWalletUpdate   = "wallet_update"
	MsgTypeUsageUpdate    = "usage_update"
	MsgTypeProviderStatus = "provider_status"
	MsgTypeNotification   = "notification"
	MsgTypeKYCUpdate      = "kyc_update"
	MsgTypeSystemAlert    = "system_alert"
	// Social feature message types
	MsgTypeNewMessage  = "new_message"
	MsgTypeNewOrder    = "new_order"
	MsgTypeNewReview   = "new_review"
	MsgTypeNewFollower = "new_follower"
	MsgTypeOrderUpdate = "order_update"
	MsgTypeNewListing  = "new_listing" // Added for real-time feed
)

var wsHub *Hub

func init() {
	wsHub = NewHub()
	go wsHub.Run()
}

// NewHub creates a new Hub
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[string]*Client),
		broadcast:  make(chan *Message, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// Run starts the hub
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.ID] = client
			h.mu.Unlock()
			log.Printf("WebSocket client connected: %s (user: %s)", client.ID, client.UserID)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				close(client.Send)
			}
			h.mu.Unlock()
			log.Printf("WebSocket client disconnected: %s", client.ID)

		case message := <-h.broadcast:
			h.mu.RLock()
			for _, client := range h.clients {
				// Send to specific user or broadcast to all
				if message.Target == "all" || message.Target == client.UserID {
					select {
					case client.Send <- mustMarshal(message):
					default:
						h.mu.RUnlock()
						h.mu.Lock()
						close(client.Send)
						delete(h.clients, client.ID)
						h.mu.Unlock()
						h.mu.RLock()
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

func mustMarshal(v interface{}) []byte {
	data, _ := json.Marshal(v)
	return data
}

// GetHub returns the global hub
func GetHub() *Hub {
	return wsHub
}

// BroadcastToUser sends a message to a specific user
func BroadcastToUser(userID string, msgType string, data interface{}) {
	msg := &Message{
		Type:      msgType,
		Target:    userID,
		Data:      data,
		Timestamp: time.Now().UnixMilli(),
	}
	wsHub.broadcast <- msg
}

// BroadcastToAll sends a message to all connected clients
func BroadcastToAll(msgType string, data interface{}) {
	msg := &Message{
		Type:      msgType,
		Target:    "all",
		Data:      data,
		Timestamp: time.Now().UnixMilli(),
	}
	wsHub.broadcast <- msg
}

// ========== WebSocket Handler ==========

// HandleWebSocket upgrades HTTP to WebSocket
func HandleWebSocket(c *gin.Context) {
	userID := c.GetString("userID")
	role := c.GetString("role")

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	client := &Client{
		ID:     generateClientID(),
		UserID: userID,
		Role:   role,
		Conn:   conn,
		Send:   make(chan []byte, 256),
		Hub:    wsHub,
	}

	wsHub.register <- client

	// Start goroutines for reading and writing
	go client.writePump()
	go client.readPump()
}

func generateClientID() string {
	return time.Now().Format("20060102150405.000000")
}

// writePump sends messages to the WebSocket connection
func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Add queued messages to the current websocket message
			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// readPump reads messages from the WebSocket connection
func (c *Client) readPump() {
	defer func() {
		c.Hub.unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(512 * 1024) // 512KB
	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		// Handle incoming messages (e.g., ping, subscribe)
		var msg Message
		if err := json.Unmarshal(message, &msg); err == nil {
			c.handleMessage(&msg)
		}
	}
}

func (c *Client) handleMessage(msg *Message) {
	switch msg.Type {
	case "ping":
		c.Send <- mustMarshal(&Message{Type: "pong", Timestamp: time.Now().UnixMilli()})
	case "subscribe":
		// Handle subscription requests
		log.Printf("Client %s subscribed to: %v", c.ID, msg.Data)
	}
}

// RegisterWebSocketRoutes registers WebSocket routes
func RegisterWebSocketRoutes(rg *gin.RouterGroup) {
	rg.GET("/ws", HandleWebSocket)
}
