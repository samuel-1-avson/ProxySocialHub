package api

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/proxyhubb/control-api/internal/ws"
)

func allowedWebSocketOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		// Non-browser clients (CLI, native apps) typically omit Origin.
		return true
	}

	allowed := websocketAllowedOrigins()
	if len(allowed) == 0 {
		env := strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT")))
		if env == "" {
			env = strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
		}
		if env == "development" || env == "dev" || env == "local" {
			return true
		}
		return false
	}

	normalise := func(s string) string {
		return strings.TrimRight(strings.ToLower(strings.TrimSpace(s)), "/")
	}
	want := normalise(origin)
	for _, candidate := range allowed {
		if normalise(candidate) == want {
			return true
		}
	}
	return false
}

func websocketAllowedOrigins() []string {
	seen := map[string]struct{}{}
	var out []string
	add := func(raw string) {
		for _, part := range strings.Split(raw, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			if _, ok := seen[part]; ok {
				continue
			}
			seen[part] = struct{}{}
			out = append(out, part)
		}
	}
	add(os.Getenv("APP_URL"))
	add(os.Getenv("CORS_ORIGINS"))
	return out
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     allowedWebSocketOrigin,
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
