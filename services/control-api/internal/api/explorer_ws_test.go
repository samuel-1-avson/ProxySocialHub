package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func TestExplorerWSReserveIP_EnforcesPerIPCap(t *testing.T) {
	explorerWSMaxPerIP = 2
	t.Cleanup(func() {
		explorerWSMaxPerIP = explorerWSMaxPerIPDefault
		explorerWSIPCounts = sync.Map{}
	})

	ip := "203.0.113.10"
	if !explorerWSReserveIP(ip) || !explorerWSReserveIP(ip) {
		t.Fatal("expected first two reservations to succeed")
	}
	if explorerWSReserveIP(ip) {
		t.Fatal("expected third reservation on same IP to fail")
	}
	explorerWSReleaseIP(ip)
	if !explorerWSReserveIP(ip) {
		t.Fatal("expected reservation after release to succeed")
	}
}

func TestExplorerHubTryAccept_EnforcesGlobalCap(t *testing.T) {
	explorerWSMaxClients = 1
	explorerWSMaxPerIP = 10
	atomic.StoreInt32(&explorerWSPending, 0)
	explorerWSIPCounts = sync.Map{}
	t.Cleanup(func() {
		explorerWSMaxClients = explorerWSMaxClientsDefault
		explorerWSMaxPerIP = explorerWSMaxPerIPDefault
		atomic.StoreInt32(&explorerWSPending, 0)
		explorerWSIPCounts = sync.Map{}
	})

	h := &ExplorerHub{clients: make(map[*websocket.Conn]bool)}
	h.clients[(nil)] = true // occupy the single slot

	if h.tryAcceptExplorerWSConnection("198.51.100.1") {
		t.Fatal("expected global cap to reject new handshake")
	}
}

func TestAllowExplorerWebSocket_BlocksWhenFullModeNotSatisfied(t *testing.T) {
	t.Setenv("FULL_DECENTRALIZATION", "true")

	originalLoader := explorerDecentralizationStatusLoader
	t.Cleanup(func() {
		explorerDecentralizationStatusLoader = originalLoader
		clearExplorerDecentralizationStatusCache()
	})

	explorerDecentralizationStatusLoader = func(windowSlots uint64) (ExplorerDecentralizationStatusResponse, error) {
		return ExplorerDecentralizationStatusResponse{
			FullyDecentralized: false,
			ExplorerMode:       "multi_writer_partial_quorum",
		}, nil
	}
	clearExplorerDecentralizationStatusCache()

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/explorer/ws", nil)

	if allowExplorerWebSocket(c) {
		t.Fatal("expected WebSocket gate to reject when quorum not satisfied")
	}
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
	if !strings.Contains(strings.ToLower(w.Body.String()), "quorum") {
		t.Fatalf("expected quorum message, got %s", w.Body.String())
	}
}

func TestAllowExplorerWebSocket_AllowsWhenFullyDecentralized(t *testing.T) {
	t.Setenv("FULL_DECENTRALIZATION", "true")

	originalLoader := explorerDecentralizationStatusLoader
	t.Cleanup(func() {
		explorerDecentralizationStatusLoader = originalLoader
		clearExplorerDecentralizationStatusCache()
	})

	explorerDecentralizationStatusLoader = func(windowSlots uint64) (ExplorerDecentralizationStatusResponse, error) {
		return ExplorerDecentralizationStatusResponse{
			FullyDecentralized: true,
			ExplorerMode:       "multi_writer_quorum",
		}, nil
	}
	clearExplorerDecentralizationStatusCache()

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/explorer/ws", nil)

	if !allowExplorerWebSocket(c) {
		t.Fatalf("expected WebSocket gate to allow, status=%d body=%s", w.Code, w.Body.String())
	}
}
