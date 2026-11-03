package api

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const maxP2PSessions = 1024
const maxICECandidates = 16
const p2pTTL = 5 * time.Minute

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

var globalSignalingStore = &P2PSignalingStore{sessions: make(map[string]*P2PSignalState)}

func RegisterP2PSignalingRoutes(r *gin.RouterGroup) {
	p := r.Group("/p2p/signal")
	p.POST("/offer", handlePostP2POffer)
	p.POST("/answer", handlePostP2PAnswer)
	p.GET("/:sessionId", handleGetP2PSignals)
	p.GET("", handleGetP2PSignals)
}

type P2POfferRequest struct {
	SessionID      string   `json:"session_id" binding:"required,uuid"`
	BuyerPubkey    string   `json:"buyer_pubkey"`
	ProviderHotkey string   `json:"provider_hotkey"`
	OfferSDP       string   `json:"offer_sdp" binding:"required,max=32768"`
	IceCandidates  []string `json:"ice_candidates" binding:"max=16,dive,max=1024"`
}
type P2PAnswerRequest struct {
	SessionID      string   `json:"session_id" binding:"required,uuid"`
	ProviderHotkey string   `json:"provider_hotkey"`
	AnswerSDP      string   `json:"answer_sdp" binding:"required,max=32768"`
	IceCandidates  []string `json:"ice_candidates" binding:"max=16,dive,max=1024"`
}

// IDs and advertised wallet identities never substitute for session ownership.
// Both sides must opt in, and the order and data-plane session must be active.
func authorizeP2P(c *gin.Context, id string, role string) (models.Order, bool) {
	c.Header("Cache-Control", "no-store")
	uid, ok := GetUserID(c)
	if !ok {
		c.JSON(401, gin.H{"error": "Authentication required"})
		return models.Order{}, false
	}
	if os.Getenv("P2P_SIGNALING_ENABLED") != "true" {
		c.JSON(403, gin.H{"error": "Direct connections are disabled"})
		return models.Order{}, false
	}
	sid, err := uuid.Parse(id)
	if err != nil {
		c.JSON(400, gin.H{"error": "Invalid session"})
		return models.Order{}, false
	}
	var order models.Order
	if db.DB.Where("session_id = ? AND status = ?", sid, models.OrderStatusActive).First(&order).Error != nil {
		c.JSON(404, gin.H{"error": "Session not available"})
		return order, false
	}
	if uid != order.BuyerID && uid != order.SellerID || role == "buyer" && uid != order.BuyerID || role == "provider" && uid != order.SellerID {
		c.JSON(403, gin.H{"error": "Access denied"})
		return order, false
	}
	var session models.Session
	if db.DB.Where("id = ? AND user_id = ? AND status = ? AND (expires_at IS NULL OR expires_at > ?)", sid, order.BuyerID, models.SessionActive, time.Now()).First(&session).Error != nil {
		c.JSON(409, gin.H{"error": "Session inactive"})
		return order, false
	}
	var n int64
	if err = db.DB.Table("profiles").Where("id IN ? AND allow_direct_connections = ? AND status IN ?", []uuid.UUID{order.BuyerID, order.SellerID}, true, []string{"active", "pending"}).Count(&n).Error; err != nil || n != 2 {
		c.JSON(403, gin.H{"error": "Both participants must consent to direct network disclosure"})
		return order, false
	}
	if blocked, err := blockedBetween(order.BuyerID, order.SellerID); err != nil || blocked {
		c.JSON(403, gin.H{"error": "Direct contact unavailable"})
		return order, false
	}
	return order, true
}
func pruneP2PLocked(now time.Time) {
	for id, state := range globalSignalingStore.sessions {
		if now.Sub(state.CreatedAt) > p2pTTL {
			delete(globalSignalingStore.sessions, id)
		}
	}
}
func handlePostP2POffer(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	var req P2POfferRequest
	if c.ShouldBindJSON(&req) != nil {
		c.JSON(400, gin.H{"error": "Invalid or oversized offer"})
		return
	}
	order, ok := authorizeP2P(c, req.SessionID, "buyer")
	if !ok {
		return
	}
	req.SessionID = uuid.MustParse(req.SessionID).String()
	now := time.Now().UTC()
	globalSignalingStore.mu.Lock()
	defer globalSignalingStore.mu.Unlock()
	pruneP2PLocked(now)
	state, exists := globalSignalingStore.sessions[req.SessionID]
	if !exists {
		if len(globalSignalingStore.sessions) >= maxP2PSessions {
			c.JSON(503, gin.H{"error": "Signaling capacity reached"})
			return
		}
		state = &P2PSignalState{SessionID: req.SessionID, BuyerPubkey: order.BuyerWallet, ProviderHotkey: order.SellerWallet, CreatedAt: now}
		globalSignalingStore.sessions[req.SessionID] = state
	}
	// Re-offering starts a new negotiation; never accumulate unbounded candidates.
	state.OfferSDP = req.OfferSDP
	state.BuyerIce = append([]string(nil), req.IceCandidates...)
	state.AnswerSDP = ""
	state.ProviderIce = nil
	state.DirectAvailable = false
	state.UpdatedAt = now
	c.JSON(200, gin.H{"status": "offer_registered", "session_id": req.SessionID, "expires_at": state.CreatedAt.Add(p2pTTL)})
}
func handlePostP2PAnswer(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	var req P2PAnswerRequest
	if c.ShouldBindJSON(&req) != nil {
		c.JSON(400, gin.H{"error": "Invalid or oversized answer"})
		return
	}
	if _, ok := authorizeP2P(c, req.SessionID, "provider"); !ok {
		return
	}
	req.SessionID = uuid.MustParse(req.SessionID).String()
	globalSignalingStore.mu.Lock()
	defer globalSignalingStore.mu.Unlock()
	pruneP2PLocked(time.Now())
	state, ok := globalSignalingStore.sessions[req.SessionID]
	if !ok {
		c.JSON(404, gin.H{"error": "Offer expired or missing"})
		return
	}
	state.AnswerSDP = req.AnswerSDP
	state.ProviderIce = append([]string(nil), req.IceCandidates...)
	state.DirectAvailable = true
	state.UpdatedAt = time.Now().UTC()
	c.JSON(200, gin.H{"status": "answer_registered", "session_id": req.SessionID})
}
func handleGetP2PSignals(c *gin.Context) {
	id := strings.TrimSpace(c.Param("sessionId"))
	if id == "" {
		id = strings.TrimSpace(c.Query("session_id"))
	}
	if _, ok := authorizeP2P(c, id, ""); !ok {
		return
	}
	id = uuid.MustParse(id).String()
	globalSignalingStore.mu.Lock()
	defer globalSignalingStore.mu.Unlock()
	pruneP2PLocked(time.Now())
	state, ok := globalSignalingStore.sessions[id]
	if !ok {
		c.JSON(404, gin.H{"error": "Session not available"})
		return
	}
	copy := *state
	copy.BuyerIce = append([]string(nil), state.BuyerIce...)
	copy.ProviderIce = append([]string(nil), state.ProviderIce...)
	c.JSON(200, copy)
}
