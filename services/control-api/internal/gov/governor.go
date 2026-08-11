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
	ActionColdToHot        = "COLD_TO_HOT"
	ActionHotToCold        = "HOT_TO_COLD"
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

// ProposeColdToHot creates a 2-of-3 ops approval for moving SOL from cold→hot.
// Crossing threshold marks the action APPROVED (ops still run the cold-key script);
// control-api never signs cold custody.
func (g *MultiSigGovernor) ProposeColdToHot(hotAddress string, amountSOL float64, proposedBy string) (uuid.UUID, error) {
	if amountSOL <= 0 {
		return uuid.Nil, fmt.Errorf("amount must be positive")
	}
	if _, err := sol.PublicKeyFromBase58(hotAddress); err != nil {
		return uuid.Nil, fmt.Errorf("invalid hot destination address")
	}
	if proposedBy != "system" && !g.admins[proposedBy] {
		return uuid.Nil, fmt.Errorf("unauthorized proposer")
	}

	g.mu.Lock()
	defer g.mu.Unlock()

	// Dedupe: reuse an open COLD_TO_HOT for the same hot target.
	for _, existing := range g.actions {
		if existing.Type == ActionColdToHot && existing.Status == "PENDING" && existing.Target == hotAddress {
			if amountSOL > existing.Amount {
				existing.Amount = amountSOL
			}
			return existing.ID, nil
		}
	}

	id := uuid.New()
	action := &MultiSigAction{
		ID:         id,
		Type:       ActionColdToHot,
		Target:     hotAddress,
		Amount:     amountSOL,
		Signatures: []string{},
		SignerIDs:  []string{},
		Threshold:  2,
		Status:     "PENDING",
		CreatedAt:  time.Now().UTC(),
		ExpiresAt:  time.Now().UTC().Add(48 * time.Hour),
	}
	if proposedBy == "system" {
		// System opens the proposal; two admins must still approve.
	} else {
		action.SignerIDs = []string{proposedBy}
		action.Signatures = append(action.Signatures, g.generateSigHash(proposedBy))
	}

	g.actions[id] = action
	logging.Info().
		Str("action_id", id.String()).
		Float64("amount_sol", amountSOL).
		Str("hot", hotAddress).
		Str("proposed_by", proposedBy).
		Msg("Cold→hot multi-sig proposed")
	return id, nil
}

// ProposeHotToCold creates a 2-of-3 approval to sweep excess SOL from hot→cold.
// On threshold, control-api executes SendSOL from the hot payout key (cold stays receive-only).
func (g *MultiSigGovernor) ProposeHotToCold(coldAddress string, amountSOL float64, proposedBy string) (uuid.UUID, error) {
	if amountSOL <= 0 {
		return uuid.Nil, fmt.Errorf("amount must be positive")
	}
	if _, err := sol.PublicKeyFromBase58(coldAddress); err != nil {
		return uuid.Nil, fmt.Errorf("invalid cold destination address")
	}
	if proposedBy != "system" && !g.admins[proposedBy] {
		return uuid.Nil, fmt.Errorf("unauthorized proposer")
	}

	g.mu.Lock()
	defer g.mu.Unlock()

	for _, existing := range g.actions {
		if existing.Type == ActionHotToCold && existing.Status == "PENDING" && existing.Target == coldAddress {
			if amountSOL > existing.Amount {
				existing.Amount = amountSOL
			}
			return existing.ID, nil
		}
	}

	id := uuid.New()
	action := &MultiSigAction{
		ID:         id,
		Type:       ActionHotToCold,
		Target:     coldAddress,
		Amount:     amountSOL,
		Signatures: []string{},
		SignerIDs:  []string{},
		Threshold:  2,
		Status:     "PENDING",
		CreatedAt:  time.Now().UTC(),
		ExpiresAt:  time.Now().UTC().Add(48 * time.Hour),
	}
	if proposedBy != "system" {
		action.SignerIDs = []string{proposedBy}
		action.Signatures = append(action.Signatures, g.generateSigHash(proposedBy))
	}

	g.actions[id] = action
	logging.Info().
		Str("action_id", id.String()).
		Float64("amount_sol", amountSOL).
		Str("cold", coldAddress).
		Str("proposed_by", proposedBy).
		Msg("Hot→cold sweep multi-sig proposed")
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

	switch action.Type {
	case ActionTreasuryWithdraw:
		if err := ExecuteTreasuryWithdraw(ctx, action); err != nil {
			action.Status = "FAILED"
			action.Error = err.Error()
			copy := *action
			return &copy, err
		}
	case ActionColdToHot:
		// Never auto-move cold funds from control-api. Approval unlocks ops playbook.
		action.Status = "APPROVED"
		action.Error = "execute scripts/gcp-topup-hot-from-cold.sh with approved amount; cold key stays offline"
		logging.Info().
			Str("action_id", action.ID.String()).
			Float64("amount_sol", action.Amount).
			Str("hot", action.Target).
			Msg("Cold→hot multi-sig approved — awaiting offline cold transfer")
	case ActionHotToCold:
		if err := ExecuteHotToColdSweep(ctx, action); err != nil {
			action.Status = "FAILED"
			action.Error = err.Error()
			copy := *action
			return &copy, err
		}
	default:
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

	lamports := solana.SOLToLamports(action.Amount)
	txHash, err := oracle.SendSOL(ctx, recipient, lamports)
	if err != nil {
		return err
	}

	action.TxHash = txHash
	action.Status = "EXECUTED"

	tm := treasury.GetManager()
	_ = tm.RecordOutgoingTransfer(ctx, action.Amount)

	logging.Info().
		Str("action_id", action.ID.String()).
		Str("tx_hash", txHash).
		Float64("amount_sol", action.Amount).
		Msg("Treasury multi-sig withdrawal executed")

	return nil
}

// ExecuteHotToColdSweep sends SOL from hot payout wallet to cold after multi-sig approval.
func ExecuteHotToColdSweep(ctx context.Context, action *MultiSigAction) error {
	oracle := solana.GetOracleClient()
	if oracle == nil {
		return fmt.Errorf("oracle not configured")
	}
	cold := treasury.GetColdTreasuryPubkey()
	if cold.IsZero() {
		return fmt.Errorf("cold treasury not configured")
	}
	target, err := sol.PublicKeyFromBase58(action.Target)
	if err != nil {
		return fmt.Errorf("invalid cold destination: %w", err)
	}
	if !target.Equals(cold) {
		return fmt.Errorf("sweep target %s does not match configured cold %s", action.Target, cold.String())
	}

	lamports := solana.SOLToLamports(action.Amount)
	if lamports == 0 {
		return fmt.Errorf("sweep amount rounds to zero")
	}

	// Re-check hot still covers the sweep (balance may have moved since propose).
	hotPK := oracle.GetPayoutPublicKey()
	bal, err := oracle.GetBalance(ctx, hotPK)
	if err != nil {
		return fmt.Errorf("hot balance: %w", err)
	}
	const feeHeadroom uint64 = 10_000
	if bal < lamports+feeHeadroom {
		return fmt.Errorf("hot underfunded for sweep: have %d need %d", bal, lamports+feeHeadroom)
	}

	txHash, err := oracle.SendSOL(ctx, cold, lamports)
	if err != nil {
		return err
	}

	action.TxHash = txHash
	action.Status = "EXECUTED"

	tm := treasury.GetManager()
	_ = tm.RecordOutgoingTransfer(ctx, action.Amount)

	logging.Info().
		Str("action_id", action.ID.String()).
		Str("tx_hash", txHash).
		Float64("amount_sol", action.Amount).
		Str("cold", cold.String()).
		Msg("Hot→cold sweep executed")

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
