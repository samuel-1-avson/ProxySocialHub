package api

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/proxyhubb/control-api/internal/ws"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Rely on CORS middleware
	},
}

// HandleWebSocket upgrades HTTP to WebSocket and registers with neutral Hub
func HandleWebSocket(c *gin.Context) {
	userID := c.GetString("userID")
	role := c.GetString("role")

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	client := &ws.Client{
		ID:     generateClientID(),
		UserID: userID,
		Role:   role,
		Conn:   conn,
		Send:   make(chan []byte, 256),
		Hub:    ws.GetHub(),
	}

	ws.GetHub().Register <- client

	go client.WritePump()
	go client.ReadPump()
}

func generateClientID() string {
	return time.Now().Format("20060102150405.000000")
}

// BroadcastToUser delegates to internal/ws
func BroadcastToUser(userID string, msgType string, data interface{}) {
	ws.BroadcastToUser(userID, msgType, data)
}

// BroadcastToAll delegates to internal/ws
func BroadcastToAll(msgType string, data interface{}) {
	ws.BroadcastToAll(msgType, data)
}

// RegisterWebSocketRoutes registers WebSocket routes
func RegisterWebSocketRoutes(rg *gin.RouterGroup) {
	rg.GET("/ws", HandleWebSocket)
}
