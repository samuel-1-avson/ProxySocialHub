package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterTeamRoutes registers team/organization routes
func RegisterTeamRoutes(rg *gin.RouterGroup) {
	rg.GET("/teams", getMyTeams)
	rg.POST("/teams", createTeam)
	rg.GET("/teams/:id", getTeam)
	rg.POST("/teams/:id/members", addTeamMember)
	rg.DELETE("/teams/:id/members/:userId", removeTeamMember)
	rg.DELETE("/teams/:id", deleteTeam)
}

// getMyTeams returns user's teams
func getMyTeams(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var memberships []models.TeamMember
	db.DB.Preload("Team").Preload("Team.Owner").Where("user_id = ?", userID).Find(&memberships)

	teams := make([]gin.H, len(memberships))
	for i, m := range memberships {
		teams[i] = gin.H{
			"team":   m.Team,
			"role":   m.Role,
			"joined": m.JoinedAt,
		}
	}

	c.JSON(http.StatusOK, gin.H{"teams": teams})
}

type CreateTeamRequest struct {
	Name string `json:"name" binding:"required"`
}

// createTeam creates a new team
func createTeam(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var req CreateTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check subscription for team limits
	allowed, _ := CheckSubscriptionLimits(userID, "teams")
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{"error": "Upgrade subscription to create teams"})
		return
	}

	tx := db.DB.Begin()

	team := models.Team{
		Name:       req.Name,
		OwnerID:    userID,
		MaxMembers: 5,
	}

	if err := tx.Create(&team).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create team"})
		return
	}

	// Add owner as member
	member := models.TeamMember{
		TeamID: team.ID,
		UserID: userID,
		Role:   models.TeamRoleOwner,
	}
	tx.Create(&member)

	tx.Commit()

	c.JSON(http.StatusCreated, team)
}

// getTeam returns team details
func getTeam(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	teamID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team ID"})
		return
	}

	// Check membership
	var membership models.TeamMember
	if err := db.DB.Where("team_id = ? AND user_id = ?", teamID, userID).First(&membership).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a member of this team"})
		return
	}

	var team models.Team
	db.DB.Preload("Owner").Preload("Members").Preload("Members.User").First(&team, "id = ?", teamID)

	c.JSON(http.StatusOK, gin.H{"team": team, "my_role": membership.Role})
}

type AddMemberRequest struct {
	UserID uuid.UUID `json:"user_id" binding:"required"`
	Role   string    `json:"role"`
}

// addTeamMember adds a member to team
func addTeamMember(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	teamID, _ := uuid.Parse(c.Param("id"))

	// Check if admin/owner
	var myMembership models.TeamMember
	if err := db.DB.Where("team_id = ? AND user_id = ?", teamID, userID).First(&myMembership).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a member"})
		return
	}

	if myMembership.Role != models.TeamRoleOwner && myMembership.Role != models.TeamRoleAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only owners and admins can add members"})
		return
	}

	var req AddMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check team size limit
	var team models.Team
	db.DB.First(&team, "id = ?", teamID)

	var memberCount int64
	db.DB.Model(&models.TeamMember{}).Where("team_id = ?", teamID).Count(&memberCount)
	if int(memberCount) >= team.MaxMembers {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Team is at maximum capacity"})
		return
	}

	role := models.TeamRoleMember
	if req.Role == string(models.TeamRoleAdmin) {
		role = models.TeamRoleAdmin
	}

	member := models.TeamMember{
		TeamID: teamID,
		UserID: req.UserID,
		Role:   role,
	}

	if err := db.DB.Create(&member).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add member"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Member added", "member": member})
}

// removeTeamMember removes a member from team
func removeTeamMember(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	teamID, _ := uuid.Parse(c.Param("id"))
	targetUserID, _ := uuid.Parse(c.Param("userId"))

	// Check if admin/owner
	var myMembership models.TeamMember
	if err := db.DB.Where("team_id = ? AND user_id = ?", teamID, userID).First(&myMembership).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a member"})
		return
	}

	if myMembership.Role != models.TeamRoleOwner && myMembership.Role != models.TeamRoleAdmin && userID != targetUserID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Cannot remove members"})
		return
	}

	// Can't remove owner
	var targetMembership models.TeamMember
	if db.DB.Where("team_id = ? AND user_id = ?", teamID, targetUserID).First(&targetMembership).Error == nil {
		if targetMembership.Role == models.TeamRoleOwner {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot remove team owner"})
			return
		}
	}

	db.DB.Where("team_id = ? AND user_id = ?", teamID, targetUserID).Delete(&models.TeamMember{})

	c.JSON(http.StatusOK, gin.H{"message": "Member removed"})
}

// deleteTeam deletes a team (owner only)
func deleteTeam(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	teamID, _ := uuid.Parse(c.Param("id"))

	var team models.Team
	if err := db.DB.First(&team, "id = ?", teamID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}

	if team.OwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only owner can delete team"})
		return
	}

	db.DB.Delete(&team)

	c.JSON(http.StatusOK, gin.H{"message": "Team deleted"})
}
