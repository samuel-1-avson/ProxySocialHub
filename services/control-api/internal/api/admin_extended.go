package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	internalNats "github.com/proxyhubb/control-api/internal/nats"
	redisClient "github.com/proxyhubb/control-api/internal/redis"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterAdminExtendedRoutes attaches additional admin-only routes.
func RegisterAdminExtendedRoutes(r *gin.RouterGroup) {
	// System health & alerts (system:monitor permission)
	r.GET("/system/health", RequirePermission("system:monitor"), adminSystemHealth)
	r.GET("/system/alerts", RequirePermission("system:monitor"), adminSystemAlerts)

	// User force-logout (users:manage permission)
	r.POST("/users/:id/force-logout", RequirePermission("users:manage"), adminForceLogout)

	// Internal admin notes per user (users:read permission)
	notes := r.Group("/users/:id/notes", RequirePermission("users:read"))
	{
		notes.GET("", adminGetNotes)
		notes.POST("", RequirePermission("users:manage"), adminAddNote)
		notes.DELETE("/:note_id", RequirePermission("users:manage"), adminDeleteNote)
	}

	// Proxy pool admin view (system:monitor permission)
	r.GET("/proxies/pools", RequirePermission("system:monitor"), adminListProxyPools)
	r.PUT("/proxies/pools/:pool_id/disable", RequirePermission("system:manage"), adminDisableProxyPool)

	// Treasury overview (system:monitor permission)
	r.GET("/treasury/overview", RequirePermission("system:monitor"), adminTreasuryOverview)

	// Feature flags (system:manage permission)
	r.GET("/feature-flags", RequirePermission("system:monitor"), adminListFeatureFlags)
	r.PUT("/feature-flags/:key", RequirePermission("system:manage"), adminUpdateFeatureFlag)

	// System config (system:manage permission)
	r.GET("/config", RequirePermission("system:monitor"), adminListSystemConfig)
	r.PUT("/config/:key", RequirePermission("system:manage"), adminUpdateSystemConfig)

	// Disputes (admin view) (disputes:manage permission)
	r.GET("/disputes", RequirePermission("disputes:read"), adminListDisputes)
	r.POST("/disputes/:id/force-resolve", RequirePermission("disputes:manage"), adminForceResolveDispute)

	// Governance (admin view) (governance:manage permission)
	r.GET("/governance/proposals", RequirePermission("governance:read"), adminListProposals)
	r.POST("/governance/proposals/:id/cancel", RequirePermission("governance:manage"), adminCancelProposal)
}

// ========== System Health ==========

type serviceHealth struct {
	Name      string `json:"name"`
	Status    string `json:"status"` // ok | degraded | down
	Message   string `json:"message,omitempty"`
	CheckedAt string `json:"checked_at"`
}

func adminSystemHealth(c *gin.Context) {
	now := time.Now().UTC().Format(time.RFC3339)
	services := []serviceHealth{}

	// Redis
	redisStatus := serviceHealth{Name: "redis", CheckedAt: now}
	if redisClient.Client != nil {
		if err := redisClient.Client.Ping(c.Request.Context()).Err(); err != nil {
			redisStatus.Status = "down"
			redisStatus.Message = err.Error()
		} else {
			redisStatus.Status = "ok"
		}
	} else {
		redisStatus.Status = "down"
		redisStatus.Message = "client not initialized"
	}
	services = append(services, redisStatus)

	// Database
	dbStatus := serviceHealth{Name: "database", CheckedAt: now}
	if db.DB != nil {
		sqlDB, err := db.DB.DB()
		if err != nil || sqlDB.Ping() != nil {
			dbStatus.Status = "down"
			if err != nil {
				dbStatus.Message = err.Error()
			}
		} else {
			dbStatus.Status = "ok"
		}
	} else {
		dbStatus.Status = "down"
		dbStatus.Message = "not initialized"
	}
	services = append(services, dbStatus)

	// NATS
	natsStatus := serviceHealth{Name: "nats", CheckedAt: now}
	if internalNats.Conn != nil && internalNats.Conn.IsConnected() {
		natsStatus.Status = "ok"
	} else {
		natsStatus.Status = "down"
		natsStatus.Message = "not connected"
	}
	services = append(services, natsStatus)

	overall := "ok"
	for _, s := range services {
		if s.Status == "down" {
			overall = "degraded"
			break
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"overall":  overall,
		"services": services,
		"time":     now,
	})
}

// adminSystemAlerts returns recent anomalies and security events.
func adminSystemAlerts(c *gin.Context) {
	var anomalies []models.SecurityAnomaly
	db.DB.Order("created_at DESC").Limit(50).Find(&anomalies)

	var lockouts []models.AccountLockout
	db.DB.Where("locked_until > ?", time.Now()).Order("locked_until DESC").Limit(20).Find(&lockouts)

	c.JSON(http.StatusOK, gin.H{
		"anomalies":       anomalies,
		"active_lockouts": lockouts,
		"count": gin.H{
			"anomalies": len(anomalies),
			"lockouts":  len(lockouts),
		},
	})
}

// ========== User Force-Logout ==========

func adminForceLogout(c *gin.Context) {
	userID := c.Param("id")

	// Terminate all active sessions in DB
	result := db.DB.Model(&models.Session{}).
		Where("user_id = ? AND status = ?", userID, models.SessionActive).
		Update("status", models.SessionTerminated)

	// Remove Redis session keys for this user via reverse-index set.
	// The provision worker stores "sessions:{userID}" as a Set of credential usernames.
	// We use DeleteAllUserSessions which handles the set membership lookup internally.
	if redisClient.Client != nil {
		redisClient.DeleteAllUserSessions(userID)
	}

	c.JSON(http.StatusOK, gin.H{
		"message":            "All sessions terminated",
		"sessions_affected":  result.RowsAffected,
		"user_id":            userID,
	})
}

// ========== Admin Notes ==========

type addNoteRequest struct {
	Content string `json:"content" binding:"required,min=1,max=2000"`
}

func adminGetNotes(c *gin.Context) {
	userID := c.Param("id")

	var notes []models.AdminNote
	if err := db.DB.Where("user_id = ?", userID).Order("created_at DESC").Find(&notes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch notes"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"notes": notes, "count": len(notes)})
}

func adminAddNote(c *gin.Context) {
	userID := c.Param("id")
	adminUsername := c.GetString("adminUsername")

	var req addNoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	uid, err := uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	// Verify user exists
	var user models.User
	if db.DB.First(&user, "id = ?", uid).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	note := models.AdminNote{
		ID:            uuid.New(),
		UserID:        uid,
		AdminUsername: adminUsername,
		Content:       req.Content,
	}

	if err := db.DB.Create(&note).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save note"})
		return
	}

	c.JSON(http.StatusCreated, note)
}

func adminDeleteNote(c *gin.Context) {
	noteID := c.Param("note_id")

	result := db.DB.Delete(&models.AdminNote{}, "id = ?", noteID)
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Note not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Note deleted"})
}

// ========== Proxy Pools ==========

func adminListProxyPools(c *gin.Context) {
	var pools []models.ProxyPool
	if err := db.DB.Order("created_at DESC").Find(&pools).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch pools"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"pools": pools, "count": len(pools)})
}

func adminDisableProxyPool(c *gin.Context) {
	poolID := c.Param("pool_id")

	result := db.DB.Model(&models.ProxyPool{}).Where("id = ?", poolID).Update("is_active", false)
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Pool not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Pool disabled", "pool_id": poolID})
}

// ========== Treasury Overview ==========

func adminTreasuryOverview(c *gin.Context) {
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	weekAgo := today.AddDate(0, 0, -7)
	monthAgo := today.AddDate(0, -1, 0)

	var totalRevenue, todayRevenue, weekRevenue, monthRevenue float64
	db.DB.Model(&models.WalletLedgerEntry{}).
		Where("type = ?", models.TransactionUsage).
		Select("COALESCE(SUM(ABS(amount)), 0)").Scan(&totalRevenue)
	db.DB.Model(&models.WalletLedgerEntry{}).
		Where("type = ? AND created_at >= ?", models.TransactionUsage, today).
		Select("COALESCE(SUM(ABS(amount)), 0)").Scan(&todayRevenue)
	db.DB.Model(&models.WalletLedgerEntry{}).
		Where("type = ? AND created_at >= ?", models.TransactionUsage, weekAgo).
		Select("COALESCE(SUM(ABS(amount)), 0)").Scan(&weekRevenue)
	db.DB.Model(&models.WalletLedgerEntry{}).
		Where("type = ? AND created_at >= ?", models.TransactionUsage, monthAgo).
		Select("COALESCE(SUM(ABS(amount)), 0)").Scan(&monthRevenue)

	var pendingPayouts float64
	db.DB.Model(&models.Wallet{}).Select("COALESCE(SUM(balance_sol), 0)").
		Where("balance_sol > ?", 0.01).Scan(&pendingPayouts)

	var totalPayouts float64
	db.DB.Model(&models.WalletLedgerEntry{}).
		Where("type = ?", models.TransactionPayout).
		Select("COALESCE(SUM(ABS(amount)), 0)").Scan(&totalPayouts)

	var activeEscrows int64
	db.DB.Model(&models.EscrowTransaction{}).Where("status = ?", "locked").Count(&activeEscrows)

	c.JSON(http.StatusOK, gin.H{
		"revenue": gin.H{
			"total":        totalRevenue,
			"today":        todayRevenue,
			"this_week":    weekRevenue,
			"this_month":   monthRevenue,
		},
		"payouts": gin.H{
			"pending_total_sol": pendingPayouts,
			"processed_total":   totalPayouts,
		},
		"escrows": gin.H{
			"active_count": activeEscrows,
		},
	})
}

// ========== Feature Flags ==========
// Feature flags are stored as SystemConfiguration rows with keys prefixed "feature."

func adminListFeatureFlags(c *gin.Context) {
	var flags []models.SystemConfiguration
	if err := db.DB.Where("key LIKE ?", "feature.%").Order("key ASC").Find(&flags).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch feature flags"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"flags": flags, "count": len(flags)})
}

type updateFlagRequest struct {
	Enabled bool `json:"enabled"`
}

func adminUpdateFeatureFlag(c *gin.Context) {
	key := "feature." + c.Param("key")

	var req updateFlagRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	value := "false"
	if req.Enabled {
		value = "true"
	}

	result := db.DB.Model(&models.SystemConfiguration{}).Where("key = ?", key).Update("value", value)
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Feature flag not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"key": key, "enabled": req.Enabled})
}

// ========== System Config ==========

func adminListSystemConfig(c *gin.Context) {
	var configs []models.SystemConfiguration
	if err := db.DB.Order("key ASC").Find(&configs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch system config"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": configs, "count": len(configs)})
}

type updateConfigRequest struct {
	Value string `json:"value" binding:"required"`
}

func adminUpdateSystemConfig(c *gin.Context) {
	key := c.Param("key")

	// Protect the schema version from admin edits
	if key == "schema_version" {
		c.JSON(http.StatusForbidden, gin.H{"error": "schema_version is read-only"})
		return
	}

	var req updateConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result := db.DB.Model(&models.SystemConfiguration{}).
		Where("key = ?", key).
		Update("value", req.Value)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update config"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"key": key, "value": req.Value})
}

// ========== Disputes ==========

func adminListDisputes(c *gin.Context) {
	var disputes []models.DisputeJury
	if err := db.DB.Order("created_at DESC").Limit(100).Find(&disputes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch disputes"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"disputes": disputes, "count": len(disputes)})
}

type forceResolveRequest struct {
	Resolution string `json:"resolution" binding:"required,oneof=refund_buyer pay_provider split"`
	Reason     string `json:"reason" binding:"required"`
}

func adminForceResolveDispute(c *gin.Context) {
	disputeID := c.Param("id")
	adminUsername := c.GetString("adminUsername")

	var req forceResolveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result := db.DB.Model(&models.DisputeJury{}).Where("id = ?", disputeID).Updates(map[string]interface{}{
		"status":     "admin_resolved",
		"verdict":    req.Resolution,
		"updated_at": time.Now(),
	})

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Dispute not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":    "Dispute force-resolved by admin",
		"dispute_id": disputeID,
		"resolution": req.Resolution,
		"resolved_by": adminUsername,
		"reason":     req.Reason,
	})
}

// ========== Governance ==========

func adminListProposals(c *gin.Context) {
	var proposals []models.Proposal
	if err := db.DB.Order("created_at DESC").Find(&proposals).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch proposals"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"proposals": proposals, "count": len(proposals)})
}

// adminCancelProposal cancels an active governance proposal.
//
// D-G4: Admins can no longer cancel proposals unilaterally once community
// voting has begun.  Cancellation is only permitted when:
//   1. The proposal is still within the 1-hour grace window (no one has voted
//      yet, so the community has not committed any stake), OR
//   2. The proposal has received zero votes from any address.
//
// This prevents the platform from silently killing inconvenient proposals
// after the community has already expressed intent.
func adminCancelProposal(c *gin.Context) {
	proposalID := c.Param("id")
	adminUsername := c.GetString("adminUsername")

	var proposal models.Proposal
	if err := db.DB.First(&proposal, "id = ?", proposalID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Proposal not found"})
		return
	}

	if proposal.Status != models.ProposalActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only active proposals can be cancelled"})
		return
	}

	// Grace window: first hour after creation, no votes cast yet.
	gracePeriod := proposal.CreatedAt.Add(1 * time.Hour)
	totalVotes := proposal.YesVotes + proposal.NoVotes
	withinGrace := time.Now().Before(gracePeriod)
	noVotesCast := totalVotes == 0

	if !withinGrace && !noVotesCast {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "Cannot cancel: voting has begun and the 1-hour grace window has passed. " +
				"Submit a counter-proposal or wait for the vote to conclude.",
			"yes_votes":    proposal.YesVotes,
			"no_votes":     proposal.NoVotes,
			"grace_expired": gracePeriod.UTC().Format(time.RFC3339),
		})
		return
	}

	db.DB.Model(&proposal).Updates(map[string]interface{}{
		"status":     "cancelled",
		"updated_at": time.Now(),
	})

	c.JSON(http.StatusOK, gin.H{
		"message":      "Proposal cancelled",
		"proposal_id":  proposalID,
		"cancelled_by": adminUsername,
		"reason":       "Within grace window or zero votes cast",
	})
}
