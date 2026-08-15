// Package incentives — Wave 4.3 observe ledger + Wave 5.C.4 dual-gated settle.
//
// PROXYHUB_PROTOCOL_INCENTIVES=off|observe|settle (default off).
// Observe writes hypothetical splits only. Settle queues pending_custody unless
// PROXYHUB_INCENTIVE_SETTLE_CONFIRM=1, which enables hot-wallet SendSOL of the
// provider incentive share. Never mints PHB/PHUBB. Gateway/treasury shares stay
// ledger-only in W5.C.4.
package incentives

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
)

const (
	defaultFeeBPS           = 500  // 5% of gross (observe accounting only)
	defaultProviderShareBPS = 6000 // 60% of fee → provider incentive accrual
	defaultGatewayShareBPS  = 2000 // 20% of fee → gateway incentive accrual
	// remainder (20%) retained as treasury observe share
)

// ErrIncentiveAwaitingCustody is returned when settle mode queues custody
// instead of dual-gated hot-wallet SendSOL.
var ErrIncentiveAwaitingCustody = errors.New("incentive queued for custody; automatic hot-wallet settle is not armed")

// Mode returns off | observe | settle.
func Mode() string {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("PROXYHUB_PROTOCOL_INCENTIVES")))
	switch raw {
	case "settle":
		return "settle"
	case "observe", "1", "true", "yes", "on":
		return "observe"
	default:
		return "off"
	}
}

func Enabled() bool { return Mode() != "off" }

// SettleModeEnabled is true when PROTOCOL_INCENTIVES=settle (first gate).
func SettleModeEnabled() bool { return Mode() == "settle" }

// SettleConfirm is the second gate for live hot-wallet incentive SendSOL.
// Must be exactly "1" (same pattern as treasury / on-chain pause confirms).
func SettleConfirm() bool {
	return strings.TrimSpace(os.Getenv("PROXYHUB_INCENTIVE_SETTLE_CONFIRM")) == "1"
}

// SolSettleArmed is true only when settle mode + confirm are both set.
func SolSettleArmed() bool {
	return SettleModeEnabled() && SettleConfirm()
}

func FeeBPS() int {
	return envBPS("PROXYHUB_PROTOCOL_FEE_BPS", defaultFeeBPS, 0, 5000)
}

func ProviderShareBPS() int {
	return envBPS("PROXYHUB_INCENTIVE_PROVIDER_SHARE_BPS", defaultProviderShareBPS, 0, 10000)
}

func GatewayShareBPS() int {
	return envBPS("PROXYHUB_INCENTIVE_GATEWAY_SHARE_BPS", defaultGatewayShareBPS, 0, 10000)
}

func envBPS(key string, def, min, max int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < min || n > max {
		return def
	}
	return n
}

// Split is a fee split (observe math; settle may pay provider share only).
type Split struct {
	FeeBPS               int
	ProviderShareBPS     int
	GatewayShareBPS      int
	GrossSOL             float64
	ProtocolFeeSOL       float64
	ProviderIncentiveSOL float64
	GatewayIncentiveSOL  float64
	TreasuryRetainSOL    float64
}

// ComputeSplit derives accounting from gross settlement SOL.
func ComputeSplit(grossSOL float64) Split {
	feeBPS := FeeBPS()
	provBPS := ProviderShareBPS()
	gwBPS := GatewayShareBPS()
	if provBPS+gwBPS > 10000 {
		// Fail closed to defaults rather than over-allocate.
		provBPS = defaultProviderShareBPS
		gwBPS = defaultGatewayShareBPS
	}
	fee := grossSOL * float64(feeBPS) / 10000.0
	prov := fee * float64(provBPS) / 10000.0
	gw := fee * float64(gwBPS) / 10000.0
	retain := fee - prov - gw
	if retain < 0 {
		retain = 0
	}
	return Split{
		FeeBPS:               feeBPS,
		ProviderShareBPS:     provBPS,
		GatewayShareBPS:      gwBPS,
		GrossSOL:             grossSOL,
		ProtocolFeeSOL:       fee,
		ProviderIncentiveSOL: prov,
		GatewayIncentiveSOL:  gw,
		TreasuryRetainSOL:    retain,
	}
}

// SettlementInput is enough context to record (and optionally settle) an event.
type SettlementInput struct {
	SessionID       uuid.UUID
	ProviderUserID  uuid.UUID
	NodeID          uuid.UUID
	GrossSOL        float64
	RecipientWallet string // optional; looked up from user when empty
}

// ObserveSettlement records a split when mode=observe|settle.
// settle without confirm → pending_custody; settle+confirm → hot-wallet SendSOL.
// No-op when off or gross <= 0. Never mints.
func ObserveSettlement(in SettlementInput) error {
	mode := Mode()
	if mode == "off" || in.GrossSOL <= 0 {
		return nil
	}
	if db.DB == nil {
		return fmt.Errorf("incentives: db not ready")
	}
	split := ComputeSplit(in.GrossSOL)
	sid := in.SessionID
	pid := in.ProviderUserID
	nid := in.NodeID

	wallet := strings.TrimSpace(in.RecipientWallet)
	if wallet == "" {
		wallet, _ = lookupProviderWallet(in.ProviderUserID)
	}

	ev := models.ProtocolIncentiveEvent{
		ID:                   uuid.New(),
		SessionID:            &sid,
		ProviderUserID:       &pid,
		NodeID:               &nid,
		EventType:            "settlement_split",
		Mode:                 mode,
		GrossAmountSOL:       split.GrossSOL,
		ProtocolFeeSOL:       split.ProtocolFeeSOL,
		ProviderIncentiveSOL: split.ProviderIncentiveSOL,
		GatewayIncentiveSOL:  split.GatewayIncentiveSOL,
		TreasuryRetainSOL:    split.TreasuryRetainSOL,
		FeeBPS:               split.FeeBPS,
		ProviderShareBPS:     split.ProviderShareBPS,
		GatewayShareBPS:      split.GatewayShareBPS,
		RecipientWallet:      wallet,
		CreatedAt:            time.Now().UTC(),
	}

	switch mode {
	case "settle":
		if SolSettleArmed() {
			return settleProviderIncentiveHotWallet(context.Background(), &ev)
		}
		ev.Status = "pending_custody"
		ev.Note = "Wave 5.C.4 settle mode without CONFIRM=1 — queued pending_custody (no mint, no SendSOL)"
		if err := db.DB.Create(&ev).Error; err != nil {
			logging.Warn().Err(err).Str("session_id", sid.String()).Msg("incentives: custody write skipped/failed")
			return err
		}
		logging.Info().
			Str("session_id", sid.String()).
			Float64("provider_incentive_sol", split.ProviderIncentiveSOL).
			Msg("incentives: pending_custody recorded")
		return ErrIncentiveAwaitingCustody
	default: // observe
		ev.Status = "observed"
		ev.Note = "Wave 4.3 observe-only — no mint, no SOL transfer"
		if err := db.DB.Create(&ev).Error; err != nil {
			logging.Warn().Err(err).Str("session_id", sid.String()).Msg("incentives: observe write skipped/failed")
			return err
		}
		logging.Info().
			Str("session_id", sid.String()).
			Float64("protocol_fee_sol", split.ProtocolFeeSOL).
			Float64("provider_incentive_sol", split.ProviderIncentiveSOL).
			Msg("incentives: observe settlement recorded")
		return nil
	}
}

// SettlePendingCustody dual-gates a pending_custody (or observed) row into hot-wallet SendSOL.
// Requires SolSettleArmed(). Gateway/treasury shares remain ledger-only.
func SettlePendingCustody(ctx context.Context, eventID uuid.UUID) error {
	if !SolSettleArmed() {
		return ErrIncentiveAwaitingCustody
	}
	if db.DB == nil {
		return fmt.Errorf("incentives: db not ready")
	}
	var ev models.ProtocolIncentiveEvent
	if err := db.DB.Where("id = ?", eventID).First(&ev).Error; err != nil {
		return fmt.Errorf("incentives: load event: %w", err)
	}
	switch ev.Status {
	case "settled":
		return nil
	case "pending_custody", "observed", "failed":
		// ok to (re)attempt
	default:
		return fmt.Errorf("incentives: status %s not settleable", ev.Status)
	}
	return settleProviderIncentiveHotWallet(ctx, &ev)
}

func settleProviderIncentiveHotWallet(ctx context.Context, ev *models.ProtocolIncentiveEvent) error {
	if ev.ProviderIncentiveSOL <= 0 {
		ev.Status = "settled"
		ev.Mode = "settle"
		ev.Note = "Wave 5.C.4 dual-gated settle — zero provider incentive; marked settled without SendSOL"
		now := time.Now().UTC()
		ev.SettledAt = &now
		return upsertIncentiveEvent(ev)
	}

	wallet := strings.TrimSpace(ev.RecipientWallet)
	if wallet == "" && ev.ProviderUserID != nil {
		wallet, _ = lookupProviderWallet(*ev.ProviderUserID)
		ev.RecipientWallet = wallet
	}
	if wallet == "" {
		ev.Status = "pending_custody"
		ev.Mode = "settle"
		ev.Note = "Wave 5.C.4 settle armed but provider wallet missing — pending_custody"
		if err := upsertIncentiveEvent(ev); err != nil {
			return err
		}
		return ErrIncentiveAwaitingCustody
	}

	recipient, err := sol.PublicKeyFromBase58(wallet)
	if err != nil {
		ev.Status = "failed"
		ev.Mode = "settle"
		ev.Note = "invalid provider wallet: " + err.Error()
		_ = upsertIncentiveEvent(ev)
		return fmt.Errorf("incentives: invalid recipient: %w", err)
	}

	lamports := solanaClient.SOLToLamports(ev.ProviderIncentiveSOL)
	if lamports == 0 {
		ev.Status = "failed"
		ev.Mode = "settle"
		ev.Note = "provider incentive rounds to zero lamports"
		_ = upsertIncentiveEvent(ev)
		return fmt.Errorf("incentives: amount rounds to zero lamports")
	}

	ev.Status = "pending_send"
	ev.Mode = "settle"
	ev.Note = "Wave 5.C.4 dual-gated hot-wallet SendSOL (provider share only; no mint)"
	if err := upsertIncentiveEvent(ev); err != nil {
		return err
	}

	oracle := solanaClient.GetOracleClient()
	if oracle == nil {
		_ = db.DB.Model(ev).Updates(map[string]interface{}{
			"status": "failed",
			"note":   "oracle client unavailable",
		}).Error
		return fmt.Errorf("incentives: oracle client unavailable")
	}

	if ctx == nil {
		ctx = context.Background()
	}
	logging.Warn().
		Str("event_id", ev.ID.String()).
		Str("recipient", wallet).
		Float64("provider_incentive_sol", ev.ProviderIncentiveSOL).
		Uint64("lamports", lamports).
		Msg("Executing dual-gated incentive hot-wallet SendSOL")

	txHash, sendErr := oracle.SendSOL(ctx, recipient, lamports)
	if sendErr != nil {
		_ = db.DB.Model(ev).Updates(map[string]interface{}{
			"status": "failed",
			"note":   "SendSOL failed: " + sendErr.Error(),
		}).Error
		return fmt.Errorf("incentives: SendSOL failed: %w", sendErr)
	}

	now := time.Now().UTC()
	if err := db.DB.Model(ev).Updates(map[string]interface{}{
		"status":     "settled",
		"tx_hash":    txHash,
		"settled_at": now,
		"note":       "Wave 5.C.4 dual-gated hot-wallet settle — provider share only; no mint",
	}).Error; err != nil {
		return fmt.Errorf("incentives: send succeeded (%s) but DB update failed: %w", txHash, err)
	}
	ev.Status = "settled"
	ev.TxHash = txHash
	ev.SettledAt = &now

	logging.Info().
		Str("event_id", ev.ID.String()).
		Str("tx_hash", txHash).
		Msg("incentives: provider share settled")
	return nil
}

func upsertIncentiveEvent(ev *models.ProtocolIncentiveEvent) error {
	var existing models.ProtocolIncentiveEvent
	err := db.DB.Where("id = ?", ev.ID).First(&existing).Error
	if err != nil {
		return db.DB.Create(ev).Error
	}
	return db.DB.Model(&existing).Updates(map[string]interface{}{
		"mode":                   ev.Mode,
		"status":                 ev.Status,
		"recipient_wallet":       ev.RecipientWallet,
		"tx_hash":                ev.TxHash,
		"settled_at":             ev.SettledAt,
		"note":                   ev.Note,
		"provider_incentive_sol": ev.ProviderIncentiveSOL,
	}).Error
}

func lookupProviderWallet(userID uuid.UUID) (string, error) {
	var u models.User
	if err := db.DB.Select("wallet_address").Where("id = ?", userID).First(&u).Error; err != nil {
		return "", err
	}
	if u.WalletAddress == nil || strings.TrimSpace(*u.WalletAddress) == "" {
		return "", fmt.Errorf("provider wallet missing")
	}
	return strings.TrimSpace(*u.WalletAddress), nil
}

// StatusMeta for public honesty endpoints.
func StatusMeta() map[string]interface{} {
	armed := SolSettleArmed()
	execPath := "observe_or_off"
	note := "Wave 4.3/5.C.4: observe ledger by default. "
	switch Mode() {
	case "settle":
		if armed {
			execPath = "hot_wallet_dual_gated"
			note += "Settle dual-gated (settle + INCENTIVE_SETTLE_CONFIRM=1) — " +
				"hot-wallet SendSOL of provider share only; no PHB mint; gateway/treasury shares ledger-only."
		} else {
			execPath = "pending_custody"
			note += "Settle mode without CONFIRM=1 queues pending_custody."
		}
	case "observe":
		execPath = "observe_only"
		note += "Observe-only — no mint, no SOL transfer."
	default:
		note += "Incentives off."
	}
	return map[string]interface{}{
		"mode":                 Mode(),
		"mint_enabled":         false,
		"sol_transfer_enabled": armed,
		"settle_confirm":       SettleConfirm(),
		"sol_settle_armed":     armed,
		"execution_path":       execPath,
		"fee_bps":              FeeBPS(),
		"provider_share_bps":   ProviderShareBPS(),
		"gateway_share_bps":    GatewayShareBPS(),
		"note":                 note,
	}
}
