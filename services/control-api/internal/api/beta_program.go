package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type betaTaskDef struct {
	Slug        string  `json:"slug"`
	Week        int     `json:"week"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	RewardUSDC  float64 `json:"reward_usdc"`
	Path        string  `json:"path,omitempty"`
	ExternalURL string  `json:"external_url,omitempty"`
	AutoDetect  string  `json:"auto_detect,omitempty"`
}

// Catalog aligned with community-testing/Program_Guide.md (DevNet beta).
var betaProgramCatalog = []betaTaskDef{
	{Slug: "account_setup", Week: 0, Title: "Account setup", Description: "Link wallet and complete your profile.", RewardUSDC: 10, Path: "/settings/profile", AutoDetect: "wallet_and_profile"},
	{Slug: "first_escrow", Week: 1, Title: "First escrow", Description: "Create your first escrow on DevNet.", RewardUSDC: 25, Path: "/marketplace", AutoDetect: "first_order"},
	{Slug: "complete_settlement", Week: 1, Title: "Complete settlement", Description: "Run a full escrow lifecycle through settlement.", RewardUSDC: 50, Path: "/orders", AutoDetect: "settled_order"},
	{Slug: "browse_listings", Week: 1, Title: "Browse listings", Description: "Explore provider listings and the marketplace map.", RewardUSDC: 0, Path: "/marketplace/map"},
	{Slug: "forum_intro", Week: 1, Title: "Forum introduction", Description: "Post in the community forum or ask a listing question.", RewardUSDC: 0, Path: "/community/forum", AutoDetect: "forum_post"},
	{Slug: "follow_provider", Week: 1, Title: "Follow a provider", Description: "Follow a provider from the community feed or a listing.", RewardUSDC: 0, Path: "/community/feed", AutoDetect: "follow_provider"},
	{Slug: "governance_readiness", Week: 2, Title: "Governance readiness", Description: "Review execution readiness and an active proposal.", RewardUSDC: 0, Path: "/governance"},
	{Slug: "cast_governance_vote", Week: 2, Title: "Cast a governance vote", Description: "Vote on an active PHB proposal (DevNet).", RewardUSDC: 0, Path: "/governance", AutoDetect: "governance_vote"},
	{Slug: "dispute_test", Week: 2, Title: "Dispute flow", Description: "Initiate or observe a dispute / jury flow on DevNet.", RewardUSDC: 75, Path: "/disputes"},
	{Slug: "jury_participation", Week: 2, Title: "Jury participation", Description: "Participate as a juror when selected.", RewardUSDC: 50, Path: "/disputes"},
	{Slug: "multisig_test", Week: 2, Title: "Multi-sig test", Description: "Participate in a multi-sig settlement path.", RewardUSDC: 100},
	{Slug: "mobile_responsive", Week: 3, Title: "Mobile check", Description: "Exercise core flows on a mobile viewport.", RewardUSDC: 0},
	{Slug: "bug_report", Week: 3, Title: "Bug report", Description: "File a valid bug via Discord #beta-testers.", RewardUSDC: 25, ExternalURL: "https://discord.gg/proxyhubb"},
	{Slug: "documentation", Week: 3, Title: "Documentation", Description: "Suggest or submit a documentation improvement.", RewardUSDC: 25, ExternalURL: "https://discord.gg/proxyhubb"},
	{Slug: "stress_escrows", Week: 4, Title: "Stress: escrows", Description: "Create multiple escrows to exercise load paths.", RewardUSDC: 0, Path: "/marketplace"},
	{Slug: "detailed_feedback", Week: 4, Title: "Detailed feedback", Description: "Submit structured product feedback in Discord.", RewardUSDC: 25, ExternalURL: "https://discord.gg/proxyhubb"},
}

// RegisterBetaProgramPublicRoutes exposes the task catalog (optional auth via separate protected sync).
func RegisterBetaProgramPublicRoutes(rg *gin.RouterGroup) {
	rg.GET("/beta-program", getBetaProgram)
}

// RegisterBetaProgramRoutes registers authenticated progress mutations.
func RegisterBetaProgramRoutes(rg *gin.RouterGroup) {
	rg.POST("/beta-program/tasks/:slug/complete", completeBetaTask)
	rg.DELETE("/beta-program/tasks/:slug/complete", uncompleteBetaTask)
	rg.POST("/beta-program/sync", syncBetaProgramProgress)
}

func getBetaProgram(c *gin.Context) {
	catalog := betaProgramCatalog
	completed := map[string]models.BetaProgramCompletion{}
	potentialUSDC := 0.0
	earnedUSDC := 0.0

	for _, t := range catalog {
		potentialUSDC += t.RewardUSDC
	}

	userID, authErr := getCurrentUserID(c)
	if authErr == nil && userID != uuid.Nil {
		syncBetaAutoDetect(userID)
		var rows []models.BetaProgramCompletion
		db.DB.Where("user_id = ?", userID).Find(&rows)
		for _, row := range rows {
			completed[row.TaskSlug] = row
		}
		for _, t := range catalog {
			if _, ok := completed[t.Slug]; ok {
				earnedUSDC += t.RewardUSDC
			}
		}
	}

	type taskView struct {
		betaTaskDef
		Completed   bool   `json:"completed"`
		CompletedAt string `json:"completed_at,omitempty"`
		Source      string `json:"source,omitempty"`
	}

	tasks := make([]taskView, 0, len(catalog))
	doneCount := 0
	for _, t := range catalog {
		v := taskView{betaTaskDef: t}
		if row, ok := completed[t.Slug]; ok {
			v.Completed = true
			v.CompletedAt = row.CompletedAt.UTC().Format(time.RFC3339)
			v.Source = row.Source
			doneCount++
		}
		tasks = append(tasks, v)
	}

	c.JSON(http.StatusOK, gin.H{
		"program": gin.H{
			"name":        "ProxyHubb Beta Testers",
			"network":     "devnet",
			"guide_path":  "community-testing/Program_Guide.md",
			"discord_url": "https://discord.gg/proxyhubb",
		},
		"tasks": tasks,
		"stats": gin.H{
			"total_tasks":     len(catalog),
			"completed_tasks": doneCount,
			"potential_usdc":  potentialUSDC,
			"earned_usdc":     earnedUSDC,
			"authenticated":   authErr == nil,
		},
	})
}

func completeBetaTask(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	slug := c.Param("slug")
	if !betaTaskExists(slug) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Unknown beta task"})
		return
	}
	recordBetaCompletion(userID, slug, "manual")
	c.JSON(http.StatusOK, gin.H{"message": "Task marked complete", "task_slug": slug})
}

func uncompleteBetaTask(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	slug := c.Param("slug")
	db.DB.Where("user_id = ? AND task_slug = ?", userID, slug).Delete(&models.BetaProgramCompletion{})
	c.JSON(http.StatusOK, gin.H{"message": "Task marked incomplete", "task_slug": slug})
}

func syncBetaProgramProgress(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	added := syncBetaAutoDetect(userID)
	c.JSON(http.StatusOK, gin.H{"synced": added})
}

func betaTaskExists(slug string) bool {
	for _, t := range betaProgramCatalog {
		if t.Slug == slug {
			return true
		}
	}
	return false
}

func recordBetaCompletion(userID uuid.UUID, slug, source string) {
	row := models.BetaProgramCompletion{
		UserID:      userID,
		TaskSlug:    slug,
		CompletedAt: time.Now().UTC(),
		Source:      source,
	}
	db.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "task_slug"}},
		DoNothing: true,
	}).Create(&row)
}

func syncBetaAutoDetect(userID uuid.UUID) int {
	added := 0
	for _, t := range betaProgramCatalog {
		if t.AutoDetect == "" {
			continue
		}
		if !betaAutoDetect(userID, t.AutoDetect) {
			continue
		}
		var existing models.BetaProgramCompletion
		err := db.DB.Where("user_id = ? AND task_slug = ?", userID, t.Slug).First(&existing).Error
		if err == gorm.ErrRecordNotFound {
			recordBetaCompletion(userID, t.Slug, "auto")
			added++
		}
	}
	return added
}

func betaAutoDetect(userID uuid.UUID, kind string) bool {
	switch kind {
	case "wallet_and_profile":
		var user models.User
		if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
			return false
		}
		hasWallet := user.WalletAddress != nil && *user.WalletAddress != ""
		hasProfile := user.DisplayName != nil && *user.DisplayName != ""
		return hasWallet && hasProfile
	case "first_order":
		var n int64
		db.DB.Model(&models.Order{}).Where("buyer_id = ?", userID).Limit(1).Count(&n)
		return n > 0
	case "settled_order":
		var n int64
		db.DB.Model(&models.Order{}).
			Where("buyer_id = ? AND status = ?", userID, models.OrderStatusCompleted).
			Limit(1).Count(&n)
		return n > 0
	case "forum_post":
		var n int64
		db.Social().Model(&models.ForumPost{}).Where("author_id = ?", userID).Limit(1).Count(&n)
		return n > 0
	case "follow_provider":
		var n int64
		db.Social().Model(&models.Follow{}).Where("follower_id = ?", userID).Limit(1).Count(&n)
		return n > 0
	case "governance_vote":
		var n int64
		db.DB.Model(&models.Vote{}).Where("voter_id = ?", userID).Limit(1).Count(&n)
		return n > 0
	default:
		return false
	}
}
