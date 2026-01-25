package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterProfileRoutes registers profile-related routes
func RegisterProfileRoutes(rg *gin.RouterGroup) {
	rg.GET("/profile", getMyProfile)
	rg.PATCH("/profile", updateProfile)
	rg.GET("/users/me", getMyProfile)      // Alias for /profile
	rg.GET("/users/:id", getPublicProfile) // By ID or username
	rg.GET("/users/:id/followers", getFollowers)
	rg.GET("/users/:id/following", getFollowing)
	rg.POST("/users/:id/follow", followUser)
	rg.DELETE("/users/:id/follow", unfollowUser)
	rg.POST("/users/:id/block", blockUser)
	rg.DELETE("/users/:id/block", unblockUser)
	rg.GET("/users/:id/activity", getUserActivity)
	rg.GET("/profile/security/history", getSecurityHistory)
}

// getSecurityHistory returns the recent login and security logs for the user
func getSecurityHistory(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var logs []models.AuditLog
	if err := db.DB.Where("actor_id = ? AND event_type LIKE ?", userID, "auth.%").
		Order("created_at DESC").Limit(50).Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch security history"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"history": logs})
}

// getMyProfile returns the authenticated user's profile
func getMyProfile(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, user.ToPublicProfile())
}

// updateProfile updates the authenticated user's profile
func updateProfile(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req models.UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Check if username is being changed and is unique
	if req.Username != nil && *req.Username != "" {
		if user.Username == nil || *user.Username != *req.Username {
			var existingUser models.User
			if err := db.DB.Where("username = ? AND id != ?", *req.Username, userID).First(&existingUser).Error; err == nil {
				c.JSON(http.StatusConflict, gin.H{"error": "Username already taken"})
				return
			}
		}
	}

	// Update fields
	updates := make(map[string]interface{})
	if req.DisplayName != nil {
		updates["display_name"] = *req.DisplayName
	}
	if req.Username != nil {
		updates["username"] = *req.Username
	}
	if req.Bio != nil {
		updates["bio"] = *req.Bio
	}
	if req.Location != nil {
		updates["location"] = *req.Location
	}
	if req.Website != nil {
		updates["website"] = *req.Website
	}
	if req.AvatarURL != nil {
		updates["avatar_url"] = *req.AvatarURL
	}
	if req.CoverImageURL != nil {
		updates["cover_image_url"] = *req.CoverImageURL
	}
	if req.Skills != nil {
		updates["skills"] = pq.StringArray(req.Skills)
	}
	if req.SocialLinks != nil {
		updates["social_links"] = models.JSONMap(req.SocialLinks)
	}
	if req.BusinessName != nil {
		updates["business_name"] = *req.BusinessName
	}
	if req.TaxID != nil {
		updates["tax_id"] = *req.TaxID
	}
	if req.ProfessionalTitle != nil {
		updates["professional_title"] = *req.ProfessionalTitle
	}
	if req.ExperienceYears != nil {
		updates["experience_years"] = *req.ExperienceYears
	}
	if req.Languages != nil {
		updates["languages"] = pq.StringArray(req.Languages)
	}
	if req.PrimarySpecialization != nil {
		updates["primary_specialization"] = *req.PrimarySpecialization
	}

	if len(updates) > 0 {
		if err := db.DB.Model(&user).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update profile"})
			return
		}
	}

	// Reload user
	db.DB.First(&user, "id = ?", userID)
	c.JSON(http.StatusOK, user.ToPublicProfile())
}

// getPublicProfile returns a user's public profile by ID or username
func getPublicProfile(c *gin.Context) {
	identifier := c.Param("id")
	currentUserID, _ := c.Get("user_id")

	var user models.User

	// Handle "me" identifier
	if identifier == "me" {
		if currentUserID == nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required to view 'me'"})
			return
		}
		if err := db.DB.First(&user, "id = ?", currentUserID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
			return
		}
	} else if parsedID, err := uuid.Parse(identifier); err == nil {
		// Try UUID
		if err := db.DB.First(&user, "id = ?", parsedID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
			return
		}
	} else {
		// Try username
		if err := db.DB.First(&user, "username = ?", identifier).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
			return
		}
	}

	profile := user.ToPublicProfile()

	// Check if current user is following this user
	if currentUserID != nil {
		var follow models.Follow
		if err := db.DB.Where("follower_id = ? AND following_id = ?", currentUserID, user.ID).First(&follow).Error; err == nil {
			profile.IsFollowing = true
		}
	}

	c.JSON(http.StatusOK, profile)
}

// getFollowers returns a user's followers
func getFollowers(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var follows []models.Follow
	var total int64

	db.DB.Model(&models.Follow{}).Where("following_id = ?", userID).Count(&total)

	if err := db.DB.Preload("Follower").
		Where("following_id = ?", userID).
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&follows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch followers"})
		return
	}

	// Convert to public profiles
	profiles := make([]models.UserPublicProfile, len(follows))
	for i, f := range follows {
		if f.Follower != nil {
			profiles[i] = f.Follower.ToPublicProfile()
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"followers": profiles,
		"total":     total,
		"page":      page,
		"limit":     limit,
	})
}

// getFollowing returns users that a user is following
func getFollowing(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var follows []models.Follow
	var total int64

	db.DB.Model(&models.Follow{}).Where("follower_id = ?", userID).Count(&total)

	if err := db.DB.Preload("Following").
		Where("follower_id = ?", userID).
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&follows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch following"})
		return
	}

	// Convert to public profiles
	profiles := make([]models.UserPublicProfile, len(follows))
	for i, f := range follows {
		if f.Following != nil {
			profiles[i] = f.Following.ToPublicProfile()
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"following": profiles,
		"total":     total,
		"page":      page,
		"limit":     limit,
	})
}

// followUser follows a user
func followUser(c *gin.Context) {
	followerID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	followingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	// Can't follow yourself
	if followerID == followingID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot follow yourself"})
		return
	}

	// Check if user exists
	var targetUser models.User
	if err := db.DB.First(&targetUser, "id = ?", followingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Check if already following
	var existingFollow models.Follow
	if err := db.DB.Where("follower_id = ? AND following_id = ?", followerID, followingID).First(&existingFollow).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Already following this user"})
		return
	}

	// Create follow relationship
	follow := models.Follow{
		FollowerID:  followerID,
		FollowingID: followingID,
	}

	tx := db.DB.Begin()

	if err := tx.Create(&follow).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to follow user"})
		return
	}

	// Update follower counts
	tx.Model(&models.User{}).Where("id = ?", followerID).Update("following_count", db.DB.Raw("following_count + 1"))
	tx.Model(&models.User{}).Where("id = ?", followingID).Update("followers_count", db.DB.Raw("followers_count + 1"))

	// Create feed event
	feedEvent := models.FeedEvent{
		ActorID:    &followerID,
		EventType:  models.FeedEventNewFollower,
		TargetType: "user",
		TargetID:   &followingID,
		Content:    "started following",
	}
	tx.Create(&feedEvent)

	tx.Commit()

	c.JSON(http.StatusOK, gin.H{"message": "Successfully followed user"})
}

// unfollowUser unfollows a user
func unfollowUser(c *gin.Context) {
	followerID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	followingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	// Check if following
	var follow models.Follow
	if err := db.DB.Where("follower_id = ? AND following_id = ?", followerID, followingID).First(&follow).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Not following this user"})
		return
	}

	tx := db.DB.Begin()

	if err := tx.Delete(&follow).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unfollow user"})
		return
	}

	// Update follower counts
	tx.Model(&models.User{}).Where("id = ?", followerID).Update("following_count", db.DB.Raw("GREATEST(following_count - 1, 0)"))
	tx.Model(&models.User{}).Where("id = ?", followingID).Update("followers_count", db.DB.Raw("GREATEST(followers_count - 1, 0)"))

	tx.Commit()

	c.JSON(http.StatusOK, gin.H{"message": "Successfully unfollowed user"})
}

// Helper functions
func getPageParam(c *gin.Context, defaultVal int) int {
	page := defaultVal
	if p := c.Query("page"); p != "" {
		if parsed, err := parseInt(p); err == nil && parsed > 0 {
			page = parsed
		}
	}
	return page
}

func getLimitParam(c *gin.Context, defaultVal int) int {
	limit := defaultVal
	if l := c.Query("limit"); l != "" {
		if parsed, err := parseInt(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}
	return limit
}

func parseInt(s string) (int, error) {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, models.ErrUserNotFound // Just need an error
		}
		n = n*10 + int(c-'0')
	}
	return n, nil
}

func parseIntHelper(s string, i *int) (int, error) {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, models.ErrUserNotFound // Just need an error
		}
		n = n*10 + int(c-'0')
	}
	*i = n
	return n, nil
}

// blockUser blocks a user
func blockUser(c *gin.Context) {
	blockerID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	blockedID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	if blockerID == blockedID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot block yourself"})
		return
	}

	block := models.Block{
		BlockerID: blockerID,
		BlockedID: blockedID,
		Reason:    "User blocked",
	}

	if err := db.DB.Create(&block).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to block user"})
		return
	}

	// Also unfollow if following
	db.DB.Where("(follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)",
		blockerID, blockedID, blockedID, blockerID).Delete(&models.Follow{})

	c.JSON(http.StatusOK, gin.H{"message": "User blocked"})
}

func unblockUser(c *gin.Context) {
	blockerID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	blockedID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	if err := db.DB.Where("blocker_id = ? AND blocked_id = ?", blockerID, blockedID).
		Delete(&models.Block{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unblock user"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User unblocked"})
}

// getUserActivity returns recent public actions by a user
func getUserActivity(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	// Optional: Check if viewer is blocked by user (Privacy)
	// For MVP, we assume public feed

	var events []models.FeedEvent
	if err := db.DB.Where("actor_id = ?", userID).
		Order("created_at DESC").
		Limit(20).
		Find(&events).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch activity"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"activity": events})
}
