package gov

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/logging"
)

// MultiSigAction represents a pending protocol decision
type MultiSigAction struct {
	ID         uuid.UUID `json:"id"`
	Type       string    `json:"type"` // TREASURY_WITHDRAW, CONFIG_UPDATE
	Target     string    `json:"target"`
	Amount     float64   `json:"amount,omitempty"`
	Signatures []string  `json:"signatures"`
	Threshold  int       `json:"threshold"`
	Status     string    `json:"status"` // PENDING, EXECUTED, REJECTED
	CreatedAt  time.Time `json:"created_at"`
	ExpiresAt  time.Time `json:"expires_at"`
}

type MultiSigGovernor struct {
	mu      sync.RWMutex
	actions map[uuid.UUID]*MultiSigAction
	admins  map[string]bool // Admin Pubkeys/AuthIDs
}

var (
	Governor *MultiSigGovernor
	once     sync.Once
)

func GetGovernor() *MultiSigGovernor {
	once.Do(func() {
		Governor = &MultiSigGovernor{
			actions: make(map[uuid.UUID]*MultiSigAction),
			admins: map[string]bool{
				"admin-1": true,
				"admin-2": true,
				"admin-3": true,
			},
		}
	})
	return Governor
}

// ProposeAction initiates a multi-sig requirement
func (g *MultiSigGovernor) ProposeAction(actionType, target string, amount float64) uuid.UUID {
	g.mu.Lock()
	defer g.mu.Unlock()

	id := uuid.New()
	action := &MultiSigAction{
		ID:         id,
		Type:       actionType,
		Target:     target,
		Amount:     amount,
		Signatures: []string{},
		Threshold:  2, // 2-of-3 Industrial Policy
		Status:     "PENDING",
		CreatedAt:  time.Now(),
		ExpiresAt:  time.Now().Add(24 * time.Hour),
	}

	g.actions[id] = action
	logging.Info().Str("action_id", id.String()).Msg("New Multi-Sig Action Proposed")
	return id
}

// SignAction adds an approval signature to a pending action
func (g *MultiSigGovernor) SignAction(actionID uuid.UUID, adminID string) (bool, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	action, ok := g.actions[actionID]
	if !ok {
		return false, fmt.Errorf("action not found")
	}

	if !g.admins[adminID] {
		return false, fmt.Errorf("unauthorized signer")
	}

	// Check if already signed
	for _, sig := range action.Signatures {
		if sig == g.generateSigHash(adminID) {
			return false, fmt.Errorf("admin already signed")
		}
	}

	// Add Signature
	action.Signatures = append(action.Signatures, g.generateSigHash(adminID))

	if len(action.Signatures) >= action.Threshold {
		action.Status = "EXECUTED"
		logging.Info().Str("action_id", actionID.String()).Msg("Multi-Sig Threshold Reached: EXECUTING")
		return true, nil
	}

	return false, nil
}

func (g *MultiSigGovernor) GetPendingActions() []*MultiSigAction {
	g.mu.RLock()
	defer g.mu.RUnlock()

	var list []*MultiSigAction
	for _, a := range g.actions {
		if a.Status == "PENDING" {
			list = append(list, a)
		}
	}
	return list
}

func (g *MultiSigGovernor) generateSigHash(adminID string) string {
	h := sha256.New()
	h.Write([]byte(adminID + "proxyhub-gov-salt"))
	return hex.EncodeToString(h.Sum(nil))
}
