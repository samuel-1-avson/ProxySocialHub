package ws

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/proxyhubb/control-api/internal/nats"
)

// ========== Message Types (Global) ==========

const (
	MsgTypeSessionUpdate  = "session_update"
	MsgTypeWalletUpdate   = "wallet_update"
	MsgTypeUsageUpdate    = "usage_update"
	MsgTypeProviderStatus = "provider_status"
	MsgTypeNotification   = "notification"
	MsgTypeSystemAlert    = "system_alert"
	// Social feature message types
	MsgTypeNewMessage     = "new_message"
	MsgTypeMessageUpdated = "message_updated"
	MsgTypeMessageDeleted = "message_deleted"
	MsgTypeNewOrder       = "new_order"
	MsgTypeNewReview      = "new_review"
	MsgTypeNewFollower    = "new_follower"
	MsgTypeOrderUpdate    = "order_update"
	MsgTypeNewListing     = "new_listing"
)

// Client represents a WebSocket client
type Client struct {
	ID        string
	UserID    string
	Role      string
	Conn      *websocket.Conn
	Send      chan []byte
	Hub       *Hub
	Authorize func() bool
}

// Hub manages all WebSocket connections
type Hub struct {
	clients    map[string]*Client
	Broadcast  chan *WSMessage
	Register   chan *Client
	Unregister chan *Client
	mu         sync.RWMutex

	natsOnce  sync.Once
	startNATS func() // set by NewHub; replaced in tests
}

// WSMessage represents a WebSocket message wrapper
type WSMessage struct {
	Type      string      `json:"type"`
	Target    string      `json:"target,omitempty"` // user ID or "all"
	Data      interface{} `json:"data"`
	Timestamp int64       `json:"timestamp"`
}

var globalHub *Hub

func init() {
	globalHub = NewHub()
	go globalHub.Run()
}

// NewHub creates a new Hub
func NewHub() *Hub {
	h := &Hub{
		clients:    make(map[string]*Client),
		Broadcast:  make(chan *WSMessage, 256),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
	}
	h.startNATS = h.listenToNATS
	return h
}

// StartNATSSubscription starts consuming broadcasts from NATS. Call it once, after
// nats.Init() has succeeded. The hub is created in init(), before main() connects to NATS,
// so subscribing from Run() always found nats.JS == nil and returned, and every
// BroadcastToUser / BroadcastToAll was dropped (BE-MED-01).
func (h *Hub) StartNATSSubscription() {
	h.natsOnce.Do(func() { go h.startNATS() })
}

// Run starts the hub
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.mu.Lock()
			h.clients[client.ID] = client
			h.mu.Unlock()
			log.Printf("WebSocket client connected: %s (user: %s)", client.ID, client.UserID)

		case client := <-h.Unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				close(client.Send)
			}
			h.mu.Unlock()
			log.Printf("WebSocket client disconnected: %s", client.ID)

		case message := <-h.Broadcast:
			// P1-02: collect slow clients under the read lock; do NOT upgrade
			// to a write lock inside the loop — that pattern can deadlock when
			// two goroutines both try to upgrade concurrently.
			data := mustMarshal(message)
			var slowClients []*Client
			h.mu.RLock()
			for _, client := range h.clients {
				if message.Target == "all" || message.Target == client.UserID {
					select {
					case client.Send <- data:
					default:
						// Channel full — mark for removal; handle outside read lock.
						slowClients = append(slowClients, client)
					}
				}
			}
			h.mu.RUnlock()
			// P1-03: remove slow/disconnected clients under write lock after
			// releasing the read lock to avoid the lock-upgrade deadlock.
			if len(slowClients) > 0 {
				h.mu.Lock()
				for _, client := range slowClients {
					if _, ok := h.clients[client.ID]; ok {
						close(client.Send)
						delete(h.clients, client.ID)
					}
				}
				h.mu.Unlock()
			}
		}
	}
}

func (h *Hub) listenToNATS() {
	if nats.JS == nil {
		return
	}

	ctx := context.Background()
	consumer, err := nats.JS.CreateOrUpdateConsumer(ctx, "MESSAGING", jetstream.ConsumerConfig{
		Durable:       "ws-hub-consumer",
		FilterSubject: "proxy.messaging.v1.broadcast",
	})
	if err != nil {
		log.Printf("[WS] Failed to create NATS consumer: %v", err)
		return
	}

	iter, _ := consumer.Messages()
	for {
		msg, err := iter.Next()
		if err != nil {
			time.Sleep(1 * time.Second)
			continue
		}

		var wsMsg WSMessage
		if err := json.Unmarshal(msg.Data(), &wsMsg); err == nil {
			h.Broadcast <- &wsMsg
		}
		msg.Ack()
	}
}

func mustMarshal(v interface{}) []byte {
	data, _ := json.Marshal(v)
	return data
}

// GetHub returns the global hub
func GetHub() *Hub {
	return globalHub
}

// BroadcastToUser sends a message to a specific user via NATS
func BroadcastToUser(userID string, msgType string, data interface{}) {
	msg := &WSMessage{
		Type:      msgType,
		Target:    userID,
		Data:      data,
		Timestamp: time.Now().UnixMilli(),
	}
	_ = nats.Publish(context.Background(), "proxy.messaging.v1.broadcast", msg)
}

// BroadcastToAll sends a message to all connected clients via NATS
func BroadcastToAll(msgType string, data interface{}) {
	msg := &WSMessage{
		Type:      msgType,
		Target:    "all",
		Data:      data,
		Timestamp: time.Now().UnixMilli(),
	}
	_ = nats.Publish(context.Background(), "proxy.messaging.v1.broadcast", msg)
}

// WritePump sends messages to the WebSocket connection
func (c *Client) WritePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			if c.Authorize != nil && !c.Authorize() {
				return
			}
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

			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			if c.Authorize != nil && !c.Authorize() {
				return
			}
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ReadPump reads messages from the WebSocket connection
func (c *Client) ReadPump() {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(512 * 1024)
	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err == nil {
			if msg.Type == "ping" {
				c.Send <- mustMarshal(&WSMessage{Type: "pong", Timestamp: time.Now().UnixMilli()})
			}
		}
	}
}
