package api

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/middleware"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// Uses real HTTP middleware, device rows, refresh storage, ticket consumption and
// established WebSocket pumps, rather than bypassing auth with a user-ID fixture.
func TestStagingSecurityTwoDeviceHTTPRefreshAndRealtimeRevocation(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("staging-devices"), "buyer")
	secret, err := requireJWTSecret()
	if err != nil {
		t.Fatal(err)
	}
	first, err := issueRequestAuthSession(nil, *user, secret)
	if err != nil {
		t.Fatal(err)
	}
	second, err := issueRequestAuthSession(nil, *user, secret)
	if err != nil {
		t.Fatal(err)
	}
	firstClaims, err := crypto.ValidateToken(first.Token, secret)
	if err != nil {
		t.Fatal(err)
	}
	var firstDevice models.UserSession
	if err := db.DB.Where("token_family = ?", firstClaims.SessionID).First(&firstDevice).Error; err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{}
	cfg.Auth.JWTSecret = secret
	r := gin.New()
	r.POST("/refresh", refreshSession)
	protected := r.Group("/")
	protected.Use(middleware.SupabaseAuthMiddleware(cfg))
	protected.GET("/probe", func(c *gin.Context) { c.Status(204) })
	protected.DELETE("/sessions/:id", revokeSession)
	protected.DELETE("/sessions", revokeAllSessions)
	protected.GET("/ws", HandleWebSocket)
	protected.POST("/ws/ticket", issueWSTicket)
	server := httptest.NewServer(r)
	defer server.Close()
	request := func(method, path, token, body string, expected int) []byte {
		t.Helper()
		req, err := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		response, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != expected {
			t.Fatalf("%s %s: got %d, want %d", method, path, response.StatusCode, expected)
		}
		return data
	}
	connect := func(token string) *websocket.Conn {
		t.Helper()
		data := request("POST", "/ws/ticket", token, `{}`, 200)
		var ticket struct {
			Ticket string `json:"ticket"`
		}
		if json.Unmarshal(data, &ticket) != nil || ticket.Ticket == "" {
			t.Fatal("no ticket")
		}
		url := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws?ticket=" + ticket.Ticket
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		if err != nil {
			t.Fatal("ticket admission", err)
		}
		t.Cleanup(func() { conn.Close() })
		if replay, response, err := websocket.DefaultDialer.Dial(url, nil); err == nil {
			replay.Close()
			t.Fatal("ticket replay admitted")
		} else if response == nil || response.StatusCode != 401 {
			t.Fatal("ticket replay returned unexpected status")
		}
		conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		if err := conn.WriteJSON(map[string]string{"type": "ping"}); err != nil {
			t.Fatal(err)
		}
		var pong struct {
			Type string `json:"type"`
		}
		if err := conn.ReadJSON(&pong); err != nil || pong.Type != "pong" {
			t.Fatal("live connection failed", err)
		}
		return conn
	}
	assertDisconnected := func(conn *websocket.Conn) {
		t.Helper()
		conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		_ = conn.WriteJSON(map[string]string{"type": "ping"})
		if _, _, err := conn.ReadMessage(); err == nil {
			t.Fatal("revoked established connection delivered data")
		} else if e, ok := err.(net.Error); ok && e.Timeout() {
			t.Fatal("revoked connection remained open")
		}
	}
	request("GET", "/probe", first.Token, "", 204)
	request("GET", "/probe", second.Token, "", 204)
	firstWS := connect(first.Token)
	secondWS := connect(second.Token)
	request("DELETE", "/sessions/"+firstDevice.ID.String(), second.Token, "", 200)
	request("GET", "/probe", first.Token, "", 401)
	request("GET", "/probe", second.Token, "", 204)
	refresh, _ := json.Marshal(map[string]string{"refresh_token": first.RefreshToken})
	request("POST", "/refresh", "", string(refresh), 401)
	assertDisconnected(firstWS)
	request("DELETE", "/sessions", second.Token, "", 200)
	request("GET", "/probe", second.Token, "", 401)
	assertDisconnected(secondWS)
}
