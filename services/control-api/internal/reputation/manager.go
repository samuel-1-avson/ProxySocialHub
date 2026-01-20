package reputation

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

// CheckAndAwardBadges evaluates a provider's performance and awards badges
func CheckAndAwardBadges(providerID uuid.UUID) {
	var badges []models.Badge
	if err := db.DB.Find(&badges).Error; err != nil {
		logging.Error(err).Msg("Failed to fetch badges")
		return
	}

	// Fetch provider aggregate stats
	var stats struct {
		TotalBytes int64
		AvgUptime  float64
		UniqueIPs  int
		FirstSeen  time.Time
	}

	// 1. Total Traffic
	db.DB.Model(&models.ProofOfService{}).
		Where("provider_id = ?", providerID).
		Select("SUM(total_bytes_served)").
		Scan(&stats.TotalBytes)

	// 2. Avg Uptime
	db.DB.Model(&models.ProofOfService{}).
		Where("provider_id = ?", providerID).
		Select("AVG(uptime_percentage)").
		Scan(&stats.AvgUptime)

	// 3. Unique IPs (Approximate sum of daily uniques, simplistic)
	db.DB.Model(&models.ProofOfService{}).
		Where("provider_id = ?", providerID).
		Select("SUM(unique_ips_served)").
		Scan(&stats.UniqueIPs)

	// 4. First joined/seen
	// Just use user created_at
	var provider models.User
	if err := db.DB.First(&provider, providerID).Error; err != nil {
		return
	}
	stats.FirstSeen = provider.CreatedAt

	// Evaluate each badge
	for _, badge := range badges {
		// Skip if already earned
		var count int64
		db.DB.Model(&models.UserBadge{}).
			Where("user_id = ? AND badge_id = ?", providerID, badge.ID).
			Count(&count)
		if count > 0 {
			continue
		}

		criteria := make(map[string]interface{})
		if err := json.Unmarshal(badge.Criteria, &criteria); err != nil {
			continue
		}

		earned := false

		// Check criteria
		if val, ok := criteria["traffic_min_gb"]; ok {
			minGB := val.(float64)
			if float64(stats.TotalBytes)/(1024*1024*1024) >= minGB {
				earned = true
			}
		}

		if val, ok := criteria["uptime_min"]; ok {
			minUptime := val.(float64)
			if stats.AvgUptime >= minUptime {
				earned = true
			}
		}

		if val, ok := criteria["geo_diversity_min"]; ok {
			minCountries := val.(float64)
			// Using Unique IPs as proxy for now, ideally we query distinct countries
			if float64(stats.UniqueIPs) >= minCountries {
				earned = true
			}
		}

		if val, ok := criteria["joined_before"]; ok {
			dateStr := val.(string)
			deadline, _ := time.Parse("2006-01-02", dateStr)
			if stats.FirstSeen.Before(deadline) {
				earned = true
			}
		}

		if earned {
			awardBadge(providerID, badge)
		}
	}
}

func awardBadge(userID uuid.UUID, badge models.Badge) {
	userBadge := models.UserBadge{
		UserID:   userID,
		BadgeID:  badge.ID,
		EarnedAt: time.Now(),
	}

	if err := db.DB.Create(&userBadge).Error; err != nil {
		logging.Error(err).Msg("Failed to award badge")
		return
	}

	// Create Feed Event
	meta := map[string]interface{}{
		"badge_name": badge.Name,
		"badge_icon": badge.Icon,
	}

	event := models.CreateFeedEvent(
		&userID,
		models.FeedEventBadgeEarned,
		"badge",
		&badge.ID,
		"earned the "+badge.Name+" badge!",
		meta,
	)

	db.DB.Create(event)

	logging.Info().
		Str("user_id", userID.String()).
		Str("badge", badge.Name).
		Msg("Badge awarded")
}
