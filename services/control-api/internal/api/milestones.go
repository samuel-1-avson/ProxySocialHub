package api

	import (
	"fmt"
	"net/http"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RegisterMilestoneRoutes registers milestone-related routes
func RegisterMilestoneRoutes(rg *gin.RouterGroup) {
	rg.GET("/milestones", getMyMilestones)
	rg.GET("/milestones/next", getNextMilestone)
	rg.POST("/milestones/:id/claim", claimMilestoneReward)
	rg.GET("/users/:id/milestones", getUserMilestones)
}

// getMyMilestones returns the current user's milestones
func getMyMilestones(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var milestones []models.UsageMilestone
	if err := db.Social().
		Preload("Provider").
		Where("user_id = ?", userID).
		Order("achieved_at DESC").
		Find(&milestones).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch milestones"})
		return
	}

	// Calculate stats
	var totalMilestones int64
	var totalRewards float64
	db.Social().Model(&models.UsageMilestone{}).Where("user_id = ?", userID).Count(&totalMilestones)
	db.Social().Model(&models.UsageMilestone{}).Where("user_id = ? AND reward_claimed = ?", userID, true).Select("COALESCE(SUM(reward_amount), 0)").Scan(&totalRewards)

	c.JSON(http.StatusOK, gin.H{
		"milestones":       milestones,
		"total_count":      totalMilestones,
		"total_rewards":    totalRewards,
		"unclaimed_rewards": calculateUnclaimedRewards(userID),
	})
}

// getNextMilestone returns the next milestone user can achieve
func getNextMilestone(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	// Get user's current usage
	var totalUsedGB float64
	db.DB.Model(&models.Session{}).
		Where("user_id = ? AND status = ?", userID, models.SessionActive).
		Select("COALESCE(SUM(bytes_used), 0) / (1024.0*1024.0*1024.0)").
		Scan(&totalUsedGB)

	// Find next milestone
	var nextMilestone *models.MilestoneDefinition
	achievedTypes := make(map[string]bool)

	var achieved []models.UsageMilestone
	db.Social().Where("user_id = ?", userID).Find(&achieved)
	for _, m := range achieved {
		achievedTypes[m.MilestoneType] = true
	}

	for i := range models.MilestoneDefinitions {
		if !achievedTypes[models.MilestoneDefinitions[i].Type] {
			nextMilestone = &models.MilestoneDefinitions[i]
			break
		}
	}

	// Calculate progress to next milestone
	var progress float64
	if nextMilestone != nil {
		progress = (totalUsedGB / nextMilestone.ThresholdGB) * 100
		if progress > 100 {
			progress = 100
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"current_usage_gb": totalUsedGB,
		"next_milestone":   nextMilestone,
		"progress_percent": progress,
		"remaining_gb":     calculateRemainingGB(totalUsedGB, nextMilestone),
	})
}

// claimMilestoneReward claims the reward for a milestone
func claimMilestoneReward(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	milestoneID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid milestone ID"})
		return
	}

	var milestone models.UsageMilestone
	if err := db.Social().Where("id = ? AND user_id = ?", milestoneID, userID).First(&milestone).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Milestone not found"})
		return
	}

	if milestone.RewardClaimed {
		c.JSON(http.StatusConflict, gin.H{"error": "Reward already claimed"})
		return
	}

	if milestone.RewardAmount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No reward available for this milestone"})
		return
	}

	// REP-004: Gate reward on on-chain usage proofs to prevent DB inflation attacks.
	// Query the user's escrow-backed orders and sum their on-chain proof bytes.
	// If the oracle is unavailable we degrade gracefully (allow claim with a warning).
	if oracle := solana.GetOracleClient(); oracle != nil {
		var orders []models.Order
		db.DB.
			Select("escrow_pda").
			Where("buyer_id = ? AND escrow_pda != ''", userID).
			Limit(20).
			Find(&orders)

		if len(orders) > 0 {
			thresholdBytes := uint64(milestone.ThresholdGB * 1024 * 1024 * 1024)
			var onChainBytes uint64
			for _, ord := range orders {
				pda, err := sol.PublicKeyFromBase58(ord.EscrowPDA)
				if err != nil {
					continue
				}
				n, err := oracle.SumUsageProofBytes(c.Request.Context(), pda)
				if err != nil {
					logging.Warn().Str("escrow", ord.EscrowPDA).Msg("claimMilestoneReward: SumUsageProofBytes failed, skipping escrow")
					continue
				}
				onChainBytes += n
				if onChainBytes >= thresholdBytes {
					break
				}
			}
			if onChainBytes < thresholdBytes {
				c.JSON(http.StatusForbidden, gin.H{
					"error":              "On-chain usage proofs do not yet meet milestone threshold",
					"threshold_bytes":    thresholdBytes,
					"on_chain_bytes":     onChainBytes,
					"threshold_gb":       milestone.ThresholdGB,
				})
				return
			}
		}
	}

	// Credit primary wallet first (idempotent via ledger reference), then mark claimed.
	// Social and primary DBs are separate — never mark claimed before a successful credit.
	claimErr := db.Social().Transaction(func(stx *gorm.DB) error {
		var locked models.UsageMilestone
		if err := stx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND user_id = ? AND reward_claimed = ?", milestoneID, userID, false).
			First(&locked).Error; err != nil {
			return err
		}
		if locked.RewardAmount <= 0 {
			return fmt.Errorf("no reward available")
		}

		creditErr := db.DB.Transaction(func(tx *gorm.DB) error {
			var existing models.WalletLedgerEntry
			if err := tx.Where("type = ? AND reference_id = ?", models.TransactionEarning, locked.ID.String()).
				First(&existing).Error; err == nil {
				return nil // already credited
			} else if err != gorm.ErrRecordNotFound {
				return err
			}
			wallet, err := models.LockWalletForUpdate(tx, userID)
			if err != nil {
				return err
			}
			return models.CreditWalletLocked(tx, wallet, locked.RewardAmount, models.TransactionEarning,
				locked.ID.String(), fmt.Sprintf("Milestone reward: %s", locked.MilestoneType))
		})
		if creditErr != nil {
			return creditErr
		}

		locked.RewardClaimed = true
		if err := stx.Save(&locked).Error; err != nil {
			return err
		}
		milestone = locked
		return nil
	})
	if claimErr != nil {
		logging.Error(claimErr).Str("milestone_id", milestoneID.String()).Msg("milestone claim failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to claim reward"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":        "Reward claimed successfully",
		"reward_amount":  milestone.RewardAmount,
		"milestone_type": milestone.MilestoneType,
	})
}

// getUserMilestones returns public milestones for a user
func getUserMilestones(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var milestones []models.UsageMilestone
	if err := db.Social().
		Preload("Provider").
		Where("user_id = ?", userID).
		Order("threshold_gb DESC").
		Limit(10).
		Find(&milestones).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch milestones"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"milestones": milestones,
	})
}

// Helper functions

func calculateUnclaimedRewards(userID uuid.UUID) float64 {
	var total float64
	db.Social().
		Model(&models.UsageMilestone{}).
		Where("user_id = ? AND reward_claimed = ? AND reward_amount > 0", userID, false).
		Select("COALESCE(SUM(reward_amount), 0)").
		Scan(&total)
	return total
}

func calculateRemainingGB(currentUsageGB float64, nextMilestone *models.MilestoneDefinition) float64 {
	if nextMilestone == nil {
		return 0
	}
	remaining := nextMilestone.ThresholdGB - currentUsageGB
	if remaining < 0 {
		return 0
	}
	return remaining
}
