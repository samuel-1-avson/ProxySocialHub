package worker

import (
	"context"
	"os"
	"strconv"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	solana "github.com/proxyhubb/control-api/internal/solana"
)

// minValidatorStakeSOL is the minimum SOL a validator must stake to remain active.
// Configurable via VALIDATOR_MIN_STAKE_SOL env var (default 1.0).
var minValidatorStakeSOL = func() float64 {
	if v := os.Getenv("VALIDATOR_MIN_STAKE_SOL"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
			return f
		}
	}
	return 1.0
}()

// StartValidatorSync polls on-chain stake balances for registered validators and
// keeps the local validators table status up to date.
func StartValidatorSync(client *solana.OracleClient) {
	if client == nil {
		logging.Warn().Msg("ValidatorSync: Solana client nil, skipping sync")
		return
	}

	stakingSvc := solana.NewStakingService(client)

	GoSupervised("ValidatorSync", 5*time.Second, func() {
		logging.Info().
			Float64("min_stake_sol", minValidatorStakeSOL).
			Msg("ValidatorSync: started Solana-staked validator sync loop")

		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		for range ticker.C {
			RunSafely("ValidatorSync.cycle", func() {
				syncValidatorStakes(stakingSvc)
			})
		}
	})
}

// syncValidatorStakes fetches on-chain stake for each known validator and
// activates or deactivates them based on the minimum stake threshold.
func syncValidatorStakes(svc *solana.StakingService) {
	var validators []models.Validator
	if err := db.DB.Where("status != ?", models.ValidatorSlashed).Find(&validators).Error; err != nil {
		logging.Error(err).Msg("ValidatorSync: failed to query validators")
		return
	}

	logging.Info().Int("count", len(validators)).Msg("ValidatorSync: syncing stake for validators")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	for i := range validators {
		v := &validators[i]

		lamports, err := svc.SyncStakeBalance(ctx, v.UserID)
		if err != nil {
			logging.Warn().Err(err).Str("hotkey", v.Hotkey).Msg("ValidatorSync: failed to fetch stake")
			continue
		}

		// Convert lamports to SOL (1 SOL = 1e9 lamports)
		stakeSOL := float64(lamports) / 1e9

		newStatus := models.ValidatorInactive
		if stakeSOL >= minValidatorStakeSOL {
			newStatus = models.ValidatorActive
		}

		now := time.Now()
		updates := map[string]interface{}{
			"staked_amount": stakeSOL,
			"status":        newStatus,
			"updated_at":    now,
		}
		if newStatus == models.ValidatorActive {
			updates["last_active_at"] = now
		}

		if err := db.DB.Model(v).Updates(updates).Error; err != nil {
			logging.Error(err).Str("hotkey", v.Hotkey).Msg("ValidatorSync: failed to update validator")
			continue
		}

		logging.Debug().
			Str("hotkey", v.Hotkey).
			Float64("stake_sol", stakeSOL).
			Str("status", string(newStatus)).
			Msg("ValidatorSync: updated validator stake")

		// Update quality scores on related listings for this provider
		db.DB.Model(&models.ProxyListing{}).
			Where("seller_id = ?", v.UserID).
			Update("quality_score", v.TrustScore)
	}
}
