package api

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/logging"
)

// P2PSignalState holds ephemeral WebRTC / QUIC rendezvous data for direct P2P NAT punching.
type P2PSignalState struct {
	SessionID       string    `json:"session_id"`
	BuyerPubkey     string    `json:"buyer_pubkey"`
	ProviderHotkey  string    `json:"provider_hotkey"`
	OfferSDP        string    `json:"offer_sdp,omitempty"`
	AnswerSDP       string    `json:"answer_sdp,omitempty"`
	BuyerIce        []string  `json:"buyer_ice,omitempty"`
	ProviderIce     []string  `json:"provider_ice,omitempty"`
	DirectAvailable bool      `json:"direct_available"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type P2PSignalingStore struct {
	mu       sync.RWMutex
	sessions map[string]*P2PSignalState
}

var globalSignalingStore = &P2PSignalingStore{
	sessions: make(map[string]*P2PSignalState),
}

// RegisterP2PSignalingRoutes attaches P2P WebRTC / QUIC signaling endpoints.
func RegisterP2PSignalingRoutes(r *gin.RouterGroup) {
	p2p := r.Group("/p2p/signal")
	{
		p2p.POST("/offer", handlePostP2POffer)
		p2p.POST("/answer", handlePostP2PAnswer)
		p2p.GET("/:sessionId", handleGetP2PSignals)
		p2p.GET("", handleGetP2PSignals)
	}
}

type P2POfferRequest struct {
	SessionID      string   `json:"session_id"`
	BuyerPubkey    string   `json:"buyer_pubkey"`
	ProviderHotkey string   `json:"provider_hotkey"`
	OfferSDP       string   `json:"offer_sdp"`
	IceCandidates  []string `json:"ice_candidates,omitempty"`
}

type P2PAnswerRequest struct {
	SessionID      string   `json:"session_id"`
	ProviderHotkey string   `json:"provider_hotkey"`
	AnswerSDP      string   `json:"answer_sdp"`
	IceCandidates  []string `json:"ice_candidates,omitempty"`
}

func handlePostP2POffer(c *gin.Context) {
	var req P2POfferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_json"})
		return
	}
	req.SessionID = strings.TrimSpace(req.SessionID)
	if req.SessionID == "" || req.OfferSDP == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_session_or_offer"})
		return
	}

	globalSignalingStore.mu.Lock()
	state, exists := globalSignalingStore.sessions[req.SessionID]
	now := time.Now().UTC()
	if !exists {
		state = &P2PSignalState{
			SessionID:      req.SessionID,
			BuyerPubkey:    req.BuyerPubkey,
			ProviderHotkey: req.ProviderHotkey,
			OfferSDP:       req.OfferSDP,
			BuyerIce:       req.IceCandidates,
			CreatedAt:      now,
			UpdatedAt:      now,
		}
		globalSignalingStore.sessions[req.SessionID] = state
	} else {
		state.OfferSDP = req.OfferSDP
		if len(req.IceCandidates) > 0 {
			state.BuyerIce = append(state.BuyerIce, req.IceCandidates...)
		}
		state.UpdatedAt = now
	}
	globalSignalingStore.mu.Unlock()

	logging.Info().
		Str("session_id", req.SessionID).
		Str("buyer", req.BuyerPubkey).
		Msg("p2p signaling: registered buyer offer")

	c.JSON(http.StatusOK, gin.H{
		"status":     "offer_registered",
		"session_id": req.SessionID,
	})
}

func handlePostP2PAnswer(c *gin.Context) {
	var req P2PAnswerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_json"})
		return
	}
	req.SessionID = strings.TrimSpace(req.SessionID)
	if req.SessionID == "" || req.AnswerSDP == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_session_or_answer"})
		return
	}

	globalSignalingStore.mu.Lock()
	state, exists := globalSignalingStore.sessions[req.SessionID]
	now := time.Now().UTC()
	if !exists {
		globalSignalingStore.mu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "session_offer_not_found"})
		return
	}
	state.AnswerSDP = req.AnswerSDP
	state.ProviderHotkey = req.ProviderHotkey
	if len(req.IceCandidates) > 0 {
		state.ProviderIce = append(state.ProviderIce, req.IceCandidates...)
	}
	state.DirectAvailable = true
	state.UpdatedAt = now
	globalSignalingStore.mu.Unlock()

	logging.Info().
		Str("session_id", req.SessionID).
		Str("provider", req.ProviderHotkey).
		Msg("p2p signaling: registered provider answer")

	c.JSON(http.StatusOK, gin.H{
		"status":     "answer_registered",
		"session_id": req.SessionID,
	})
}

func handleGetP2PSignals(c *gin.Context) {
	sessionID := c.Param("sessionId")
	if sessionID == "" {
		sessionID = c.Query("session_id")
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_session_id"})
		return
	}

	globalSignalingStore.mu.RLock()
	state, exists := globalSignalingStore.sessions[sessionID]
	var copyState P2PSignalState
	if exists {
		copyState = *state
	}
	globalSignalingStore.mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "session_not_found"})
		return
	}

	c.JSON(http.StatusOK, copyState)
}
