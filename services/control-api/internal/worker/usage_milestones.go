package worker

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/ws"
)

// UsageMilestoneWorker monitors session usage and triggers milestones
type UsageMilestoneWorker struct {
	ctx    context.Context
	cancel context.CancelFunc
	ticker *time.Ticker
}

// NewUsageMilestoneWorker creates a new milestone worker
func NewUsageMilestoneWorker() *UsageMilestoneWorker {
	ctx, cancel := context.WithCancel(context.Background())
	return &UsageMilestoneWorker{
		ctx:    ctx,
		cancel: cancel,
	}
}

// Start begins the milestone monitoring loop
func (w *UsageMilestoneWorker) Start() {
	log.Println("[UsageMilestoneWorker] Started")

	// Run immediately on start
	RunSafely("UsageMilestoneWorker.initial", w.checkMilestones)

	// Then run on ticker
	GoSupervised("UsageMilestoneWorker", 5*time.Second, func() {
		w.ticker = time.NewTicker(5 * time.Minute) // Check every 5 minutes
		defer w.ticker.Stop()
		for {
			select {
			case <-w.ctx.Done():
				return
			case <-w.ticker.C:
				RunSafely("UsageMilestoneWorker.cycle", w.checkMilestones)
			}
		}
	})
}

// Stop halts the worker
func (w *UsageMilestoneWorker) Stop() {
	w.cancel()
	if w.ticker != nil {
		w.ticker.Stop()
		w.ticker = nil
	}
	log.Println("[UsageMilestoneWorker] Stopped")
}

// checkMilestones scans all active sessions and checks for milestones
func (w *UsageMilestoneWorker) checkMilestones() {
	start := time.Now()
	log.Println("[UsageMilestoneWorker] Checking milestones...")

	// Get all active sessions with usage
	var sessions []models.Session
	if err := db.DB.
		Where("status = ? AND bytes_used > 0", models.SessionActive).
		Preload("Listing").
		Preload("Listing.Seller").
		Find(&sessions).Error; err != nil {
		log.Printf("[UsageMilestoneWorker] Error fetching sessions: %v", err)
		return
	}

	for _, session := range sessions {
		// Convert bytes to GB
		usedGB := float64(session.BytesUsed) / (1024 * 1024 * 1024)

		// Check each milestone definition
		for _, def := range models.MilestoneDefinitions {
			if usedGB >= def.ThresholdGB {
				w.processMilestone(session, def)
			}
		}

		// Check for low balance (alert at 20% remaining)
		if session.BandwidthLimit > 0 {
			limitGB := float64(session.BandwidthLimit) / (1024 * 1024 * 1024)
			remainingGB := limitGB - usedGB
			percentRemaining := (remainingGB / limitGB) * 100

			if percentRemaining <= 20 && percentRemaining > 0 {
				w.checkLowBalanceAlert(session, remainingGB, percentRemaining)
			}
		}
	}

	log.Printf("[UsageMilestoneWorker] Checked %d sessions in %v", len(sessions), time.Since(start))
}

// processMilestone checks and creates a milestone if not exists
func (w *UsageMilestoneWorker) processMilestone(session models.Session, def models.MilestoneDefinition) {
	// Check if milestone already exists
	var existing models.UsageMilestone
	err := db.Social().
		Where("user_id = ? AND milestone_type = ? AND threshold_gb = ?",
			session.UserID, def.Type, def.ThresholdGB).
		First(&existing).Error

	if err == nil {
		// Milestone already exists
		return
	}

	// Create new milestone
	milestone := models.UsageMilestone{
		UserID:        session.UserID,
		ProviderID:    &session.Listing.SellerID,
		MilestoneType: def.Type,
		ThresholdGB:   def.ThresholdGB,
		RewardAmount:  def.RewardAmount,
		AchievedAt:    time.Now(),
	}

	if err := db.Social().Create(&milestone).Error; err != nil {
		log.Printf("[UsageMilestoneWorker] Error creating milestone: %v", err)
		return
	}

	log.Printf("[UsageMilestoneWorker] Milestone achieved: %s - %.0fGB by user %s",
		def.Type, def.ThresholdGB, session.UserID)

	// Notify user
	w.notifyUserOfMilestone(session, milestone, def)

	// Notify provider
	w.notifyProviderOfMilestone(session, milestone, def)

	// Create feed event
	w.createFeedEvent(session, milestone, def)

	// Award badge if applicable
	if def.BadgeName != "" {
		w.awardBadge(session.UserID, def.BadgeName)
	}

	// Update relationship score
	w.updateRelationshipScore(session)
}

// notifyUserOfMilestone sends notification to user
func (w *UsageMilestoneWorker) notifyUserOfMilestone(session models.Session, milestone models.UsageMilestone, def models.MilestoneDefinition) {
	// Build notification message
	message := fmt.Sprintf("🎉 You've used %.0fGB of proxy bandwidth!", def.ThresholdGB)

	if def.BadgeName != "" {
		message += fmt.Sprintf("\n🏆 Earned: %s badge", def.BadgeName)
	}

	if def.RewardAmount > 0 {
		message += fmt.Sprintf("\n💰 Reward: $%.2f credit", def.RewardAmount)
	}

	// WebSocket notification
	ws.BroadcastToUser(session.UserID.String(), "usage_milestone", gin.H{
		"milestone_id":  milestone.ID,
		"type":          def.Type,
		"threshold_gb":  def.ThresholdGB,
		"badge_name":    def.BadgeName,
		"reward_amount": def.RewardAmount,
		"provider_id":   session.Listing.SellerID,
		"provider_name": session.Listing.Seller.DisplayName,
		"session_id":    session.ID,
		"message":       message,
		"prompt_review": def.ThresholdGB >= 10, // Prompt review at 10GB+
	})

	// Create notification record
	notification := models.Notification{
		UserID: session.UserID,
		Type:   models.NotificationMilestone,
		Title:  fmt.Sprintf("%.0fGB Milestone!", def.ThresholdGB),
		Body:   message,
	}
	if err := notification.CreateDeduped(db.Social()); err != nil {
		log.Printf("usage_milestones: failed to create milestone notification: %v", err)
	}
}

// notifyProviderOfMilestone informs provider of buyer's milestone
func (w *UsageMilestoneWorker) notifyProviderOfMilestone(session models.Session, milestone models.UsageMilestone, def models.MilestoneDefinition) {
	// Only notify for significant milestones
	if def.ThresholdGB < 10 {
		return
	}

	message := fmt.Sprintf("🎉 Your customer has used %.0fGB!", def.ThresholdGB)

	ws.BroadcastToUser(session.Listing.SellerID.String(), "customer_milestone", gin.H{
		"buyer_id":       session.UserID,
		"threshold_gb":   def.ThresholdGB,
		"session_id":     session.ID,
		"message":        message,
		"suggest_refill": def.ThresholdGB >= 50, // Suggest refill at 50GB+
	})
}

// createFeedEvent creates a public feed event for major milestones
func (w *UsageMilestoneWorker) createFeedEvent(session models.Session, milestone models.UsageMilestone, def models.MilestoneDefinition) {
	// Only major milestones go to feed
	if def.ThresholdGB < 100 {
		return
	}

	event := models.CreateFeedEvent(
		&session.UserID,
		models.FeedEventMilestone,
		"usage",
		&session.ID,
		fmt.Sprintf("achieved %.0fGB bandwidth milestone", def.ThresholdGB),
		map[string]interface{}{
			"threshold_gb": def.ThresholdGB,
			"badge_name":   def.BadgeName,
			"provider_id":  session.Listing.SellerID,
		},
	)

	db.Social().Create(event)
}

// awardBadge awards a badge to user
func (w *UsageMilestoneWorker) awardBadge(userID uuid.UUID, badgeName string) {
	// Check if badge exists
	var badge models.Badge
	if err := db.Social().Where("name = ?", badgeName).First(&badge).Error; err != nil {
		// Create badge if doesn't exist
		badge = models.Badge{
			Name:        badgeName,
			Description: getBadgeDescription(badgeName),
			Icon:        getBadgeIcon(badgeName),
		}
		db.Social().Create(&badge)
	}

	// Check if user already has badge
	var existing models.UserBadge
	if err := db.Social().Where("user_id = ? AND badge_id = ?", userID, badge.ID).First(&existing).Error; err == nil {
		return // Already has badge
	}

	// Award badge
	userBadge := models.UserBadge{
		UserID:  userID,
		BadgeID: badge.ID,
	}
	db.Social().Create(&userBadge)

	log.Printf("[UsageMilestoneWorker] Badge awarded: %s to user %s", badgeName, userID)
}

// updateRelationshipScore updates the provider-buyer relationship score
func (w *UsageMilestoneWorker) updateRelationshipScore(session models.Session) {
	usedGB := float64(session.BytesUsed) / (1024 * 1024 * 1024)

	var relationship models.ProviderBuyerRelationship
	err := db.Social().
		Where("provider_id = ? AND buyer_id = ?", session.Listing.SellerID, session.UserID).
		First(&relationship).Error

	if err != nil {
		// Create new relationship
		relationship = models.ProviderBuyerRelationship{
			ProviderID:        session.Listing.SellerID,
			BuyerID:           session.UserID,
			FirstSessionAt:    session.CreatedAt,
			LastSessionAt:     &session.CreatedAt,
			TotalBandwidthGB:  usedGB,
			RelationshipScore: int(usedGB), // 1 point per GB
		}
		db.Social().Create(&relationship)
	} else {
		// Update existing
		updates := map[string]interface{}{
			"last_session_at":    time.Now(),
			"total_bandwidth_gb": relationship.TotalBandwidthGB + usedGB,
			"relationship_score": relationship.RelationshipScore + int(usedGB),
		}

		// Upgrade to VIP if significant usage
		if relationship.TotalBandwidthGB+usedGB >= 100 && relationship.Status != "vip" {
			updates["status"] = "vip"
		}

		db.Social().Model(&relationship).Updates(updates)
	}
}

// checkLowBalanceAlert checks and sends low balance alerts
func (w *UsageMilestoneWorker) checkLowBalanceAlert(session models.Session, remainingGB, percentRemaining float64) {
	// Send alert to user
	ws.BroadcastToUser(session.UserID.String(), "low_balance", gin.H{
		"session_id":        session.ID,
		"remaining_gb":      remainingGB,
		"percent_remaining": percentRemaining,
		"provider_id":       session.Listing.SellerID,
		"listing_title":     session.Listing.Title,
		"message":           fmt.Sprintf("⚠️ Low balance: %.1fGB remaining (%.0f%%)", remainingGB, percentRemaining),
	})

	// Notify provider for potential refill offer
	ws.BroadcastToUser(session.Listing.SellerID.String(), "customer_low_balance", gin.H{
		"buyer_id":          session.UserID,
		"session_id":        session.ID,
		"remaining_gb":      remainingGB,
		"percent_remaining": percentRemaining,
		"message":           fmt.Sprintf("Customer has %.1fGB remaining", remainingGB),
	})

	log.Printf("[UsageMilestoneWorker] Low balance alert: session %s has %.1fGB remaining",
		session.ID, remainingGB)
}

// Helper functions

func getBadgeDescription(name string) string {
	descriptions := map[string]string{
		"First Steps":        "Used your first GB of proxy bandwidth",
		"Power User":         "Used 10GB of proxy bandwidth",
		"Bandwidth Champion": "Used 100GB of proxy bandwidth",
		"Heavy Hitter":       "Used 500GB of proxy bandwidth",
		"1TB Club":           "Used 1TB of proxy bandwidth - Elite user!",
	}
	return descriptions[name]
}

func getBadgeIcon(name string) string {
	icons := map[string]string{
		"First Steps":        "footprints",
		"Power User":         "zap",
		"Bandwidth Champion": "trophy",
		"Heavy Hitter":       "hammer",
		"1TB Club":           "crown",
	}
	return icons[name]
}

// Global worker instance
var milestoneWorker *UsageMilestoneWorker

// InitUsageMilestoneWorker initializes and starts the worker
func InitUsageMilestoneWorker() {
	milestoneWorker = NewUsageMilestoneWorker()
	milestoneWorker.Start()
}

// StopUsageMilestoneWorker stops the worker
func StopUsageMilestoneWorker() {
	if milestoneWorker != nil {
		milestoneWorker.Stop()
	}
}
