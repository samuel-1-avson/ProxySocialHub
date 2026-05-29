package gov

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/treasury"
)

const (
	ActionTreasuryWithdraw = "TREASURY_WITHDRAW"
	ActionConfigUpdate     = "CONFIG_UPDATE"
)

// MultiSigAction represents a pending protocol decision.
type MultiSigAction struct {
	ID         uuid.UUID `json:"id"`
	Type       string    `json:"type"`
	Target     string    `json:"target"`
	Amount     float64   `json:"amount,omitempty"`
	Signatures []string  `json:"signatures"`
	SignerIDs  []string  `json:"signer_ids"`
	Threshold  int       `json:"threshold"`
	Status     string    `json:"status"` // PENDING, EXECUTED, REJECTED, FAILED
	TxHash     string    `json:"tx_hash,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	ExpiresAt  time.Time `json:"expires_at"`
	Error      string    `json:"error,omitempty"`
}

type MultiSigGovernor struct {
	mu      sync.RWMutex
	actions map[uuid.UUID]*MultiSigAction
	admins  map[string]bool
}

var (
	Governor *MultiSigGovernor
	once     sync.Once
)

func GetGovernor() *MultiSigGovernor {
	once.Do(func() {
		Governor = &MultiSigGovernor{
			actions: make(map[uuid.UUID]*MultiSigAction),
			admins:  loadTreasuryAdminIDs(),
		}
	})
	return Governor
}

func loadTreasuryAdminIDs() map[string]bool {
	admins := make(map[string]bool)
	raw := os.Getenv("TREASURY_MULTISIG_ADMIN_IDS")
	if raw == "" {
		// Dev defaults — override in production via env.
		for _, id := range []string{"admin-1", "admin-2", "admin-3"} {
			admins[id] = true
		}
		return admins
	}
	for _, part := range strings.Split(raw, ",") {
		id := strings.TrimSpace(part)
		if id != "" {
			admins[id] = true
		}
	}
	return admins
}

// ProposeTreasuryWithdraw creates a 2-of-3 proposal for large treasury outflows.
func (g *MultiSigGovernor) ProposeTreasuryWithdraw(target string, amountSOL float64, proposedBy string) (uuid.UUID, error) {
	if amountSOL <= treasury.LargeTreasuryWithdrawalSOL {
		return uuid.Nil, fmt.Errorf("amount %.4f SOL does not require multi-sig (threshold > %.0f SOL)",
			amountSOL, treasury.LargeTreasuryWithdrawalSOL)
	}
	if _, err := sol.PublicKeyFromBase58(target); err != nil {
		return uuid.Nil, fmt.Errorf("invalid destination address")
	}
	if !g.admins[proposedBy] {
		return uuid.Nil, fmt.Errorf("unauthorized proposer")
	}

	g.mu.Lock()
	defer g.mu.Unlock()

	id := uuid.New()
	action := &MultiSigAction{
		ID:         id,
		Type:       ActionTreasuryWithdraw,
		Target:     target,
		Amount:     amountSOL,
		Signatures: []string{},
		SignerIDs:  []string{proposedBy},
		Threshold:  2,
		Status:     "PENDING",
		CreatedAt:  time.Now().UTC(),
		ExpiresAt:  time.Now().UTC().Add(24 * time.Hour),
	}
	action.Signatures = append(action.Signatures, g.generateSigHash(proposedBy))

	g.actions[id] = action
	logging.Info().Str("action_id", id.String()).Float64("amount_sol", amountSOL).Msg("Treasury withdraw multi-sig proposed")
	return id, nil
}

// SignAndMaybeExecute adds an admin approval and executes treasury withdrawals when threshold is met.
func (g *MultiSigGovernor) SignAndMaybeExecute(ctx context.Context, actionID uuid.UUID, adminID string) (*MultiSigAction, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	action, ok := g.actions[actionID]
	if !ok {
		return nil, fmt.Errorf("action not found")
	}
	if action.Status != "PENDING" {
		return nil, fmt.Errorf("action is not pending")
	}
	if time.Now().UTC().After(action.ExpiresAt) {
		action.Status = "REJECTED"
		action.Error = "expired"
		return nil, fmt.Errorf("action expired")
	}
	if !g.admins[adminID] {
		return nil, fmt.Errorf("unauthorized signer")
	}

	for _, sid := range action.SignerIDs {
		if sid == adminID {
			return nil, fmt.Errorf("admin already signed")
		}
	}

	action.SignerIDs = append(action.SignerIDs, adminID)
	action.Signatures = append(action.Signatures, g.generateSigHash(adminID))

	if len(action.Signatures) < action.Threshold {
		copy := *action
		return &copy, nil
	}

	if action.Type == ActionTreasuryWithdraw {
		if err := ExecuteTreasuryWithdraw(ctx, action); err != nil {
			action.Status = "FAILED"
			action.Error = err.Error()
			copy := *action
			return &copy, err
		}
	} else {
		action.Status = "EXECUTED"
	}

	copy := *action
	return &copy, nil
}

// ExecuteTreasuryWithdraw sends SOL after threshold signatures (caller must hold lock externally).
func ExecuteTreasuryWithdraw(ctx context.Context, action *MultiSigAction) error {
	oracle := solana.GetOracleClient()
	if oracle == nil {
		return fmt.Errorf("oracle not configured")
	}

	recipient, err := sol.PublicKeyFromBase58(action.Target)
	if err != nil {
		return fmt.Errorf("invalid recipient: %w", err)
	}

	lamports := uint64(action.Amount * float64(solana.LamportsPerSOL))
	txHash, err := oracle.SendSOL(ctx, recipient, lamports)
	if err != nil {
		return err
	}

	action.TxHash = txHash
	action.Status = "EXECUTED"

	tm := treasury.NewTreasuryManager()
	_ = tm.RecordOutgoingTransfer(ctx, action.Amount)

	logging.Info().
		Str("action_id", action.ID.String()).
		Str("tx_hash", txHash).
		Float64("amount_sol", action.Amount).
		Msg("Treasury multi-sig withdrawal executed")

	return nil
}

func (g *MultiSigGovernor) GetAction(actionID uuid.UUID) (*MultiSigAction, bool) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	action, ok := g.actions[actionID]
	if !ok {
		return nil, false
	}
	copy := *action
	return &copy, true
}

func (g *MultiSigGovernor) GetPendingActions() []*MultiSigAction {
	g.mu.RLock()
	defer g.mu.RUnlock()

	var list []*MultiSigAction
	for _, a := range g.actions {
		if a.Status == "PENDING" {
			copy := *a
			list = append(list, &copy)
		}
	}
	return list
}

func (g *MultiSigGovernor) IsAdmin(adminID string) bool {
	return g.admins[adminID]
}

func (g *MultiSigGovernor) generateSigHash(adminID string) string {
	h := sha256.New()
	h.Write([]byte(adminID + "proxyhub-gov-salt"))
	return hex.EncodeToString(h.Sum(nil))
}
