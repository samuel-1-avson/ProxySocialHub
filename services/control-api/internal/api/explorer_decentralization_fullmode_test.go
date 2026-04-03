package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestExplorerFullModeGate_BlocksProtectedRouteWhenNotFullyDecentralized(t *testing.T) {
	t.Setenv("FULL_DECENTRALIZATION", "true")

	originalLoader := explorerDecentralizationStatusLoader
	t.Cleanup(func() {
		explorerDecentralizationStatusLoader = originalLoader
		clearExplorerDecentralizationStatusCache()
	})

	explorerDecentralizationStatusLoader = func(windowSlots uint64) (ExplorerDecentralizationStatusResponse, error) {
		return ExplorerDecentralizationStatusResponse{
			Chain:               "solana",
			WindowSlots:         windowSlots,
			LatestAttestedSlot:  1000,
			RecentSlotsAnalyzed: 256,
			UniqueWriters:       3,
			MinWritersRequired:  3,
			SlotsMeetingQuorum:  180,
			ConflictingSlots:    0,
			QuorumRatio:         180.0 / 256.0,
			ExplorerMode:        "multi_writer_partial_quorum",
			FullyDecentralized:  false,
		}, nil
	}
	clearExplorerDecentralizationStatusCache()

	r := setupTestRouter()
	explorer := r.Group("/v1/explorer")
	explorer.Use(enforceExplorerFullDecentralization())
	explorer.GET("/blocks", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/explorer/blocks", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusServiceUnavailable, w.Code, w.Body.String())
	}
	if mode := w.Header().Get("X-ProxyHubb-Explorer-Mode"); mode != "multi_writer_partial_quorum" {
		t.Fatalf("expected explorer mode header to be set, got %q", mode)
	}
	if !strings.Contains(strings.ToLower(w.Body.String()), "quorum requirements not satisfied") {
		t.Fatalf("expected quorum gate message, got %s", w.Body.String())
	}
}

func TestExplorerFullModeGate_BypassesDecentralizationStatusEndpoint(t *testing.T) {
	t.Setenv("FULL_DECENTRALIZATION", "true")

	originalLoader := explorerDecentralizationStatusLoader
	t.Cleanup(func() {
		explorerDecentralizationStatusLoader = originalLoader
		clearExplorerDecentralizationStatusCache()
	})

	explorerDecentralizationStatusLoader = func(windowSlots uint64) (ExplorerDecentralizationStatusResponse, error) {
		return ExplorerDecentralizationStatusResponse{FullyDecentralized: false, ExplorerMode: "multi_writer_partial_quorum"}, nil
	}
	clearExplorerDecentralizationStatusCache()

	r := setupTestRouter()
	explorer := r.Group("/v1/explorer")
	explorer.Use(enforceExplorerFullDecentralization())
	explorer.GET("/decentralization/status", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/explorer/decentralization/status", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, w.Code, w.Body.String())
	}
}

func TestExplorerFullModeGate_AllowsProtectedRouteWhenFullyDecentralized(t *testing.T) {
	t.Setenv("FULL_DECENTRALIZATION", "true")

	originalLoader := explorerDecentralizationStatusLoader
	t.Cleanup(func() {
		explorerDecentralizationStatusLoader = originalLoader
		clearExplorerDecentralizationStatusCache()
	})

	explorerDecentralizationStatusLoader = func(windowSlots uint64) (ExplorerDecentralizationStatusResponse, error) {
		return ExplorerDecentralizationStatusResponse{
			Chain:               "solana",
			WindowSlots:         windowSlots,
			LatestAttestedSlot:  1000,
			RecentSlotsAnalyzed: 256,
			UniqueWriters:       4,
			MinWritersRequired:  3,
			SlotsMeetingQuorum:  256,
			ConflictingSlots:    0,
			QuorumRatio:         1,
			ExplorerMode:        "multi_writer_quorum",
			FullyDecentralized:  true,
		}, nil
	}
	clearExplorerDecentralizationStatusCache()

	r := setupTestRouter()
	explorer := r.Group("/v1/explorer")
	explorer.Use(enforceExplorerFullDecentralization())
	explorer.GET("/blocks", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/explorer/blocks", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, w.Code, w.Body.String())
	}
	if mode := w.Header().Get("X-ProxyHubb-Explorer-Mode"); mode != "multi_writer_quorum" {
		t.Fatalf("expected explorer mode header %q, got %q", "multi_writer_quorum", mode)
	}
	if got := w.Header().Get("X-ProxyHubb-Authority-Mode"); got != authorityModeHybridAsyncChain {
		t.Fatalf("expected authority mode %q, got %q", authorityModeHybridAsyncChain, got)
	}
}
