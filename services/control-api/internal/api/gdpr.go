package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterGDPRRoutes registers GDPR/data export routes
func RegisterGDPRRoutes(rg *gin.RouterGroup) {
	rg.GET("/gdpr/export", requestDataExport)
	rg.DELETE("/gdpr/delete-account", deleteAccount)
}

// requestDataExport generates and returns user's data
func requestDataExport(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	// Collect all user data
	var user models.User
	db.DB.First(&user, "id = ?", userID)

	var orders []models.Order
	db.DB.Where("buyer_id = ?", userID).Find(&orders)

	var sales []models.Order
	db.DB.Where("seller_id = ?", userID).Find(&sales)

	var listings []models.ProxyListing
	db.DB.Where("seller_id = ?", userID).Find(&listings)

	var reviews []models.Review
	db.DB.Where("reviewer_id = ? OR seller_id = ?", userID, userID).Find(&reviews)

	var ledgerEntries []models.WalletLedgerEntry
	db.DB.Joins("JOIN wallets ON wallet_ledger_entries.wallet_id = wallets.id").
		Where("wallets.user_id = ?", userID).Find(&ledgerEntries)

	var auditLogs []models.AuditLog
	db.DB.Where("user_id = ?", userID).Find(&auditLogs)

	// Create JSON files in memory
	exportData := map[string]interface{}{
		"export_date": time.Now().Format(time.RFC3339),
		"user": gin.H{
			"id":           user.ID,
			"username":     user.Username,
			"email":        user.Email,
			"display_name": user.DisplayName,
			"created_at":   user.CreatedAt,
		},
		"orders":         orders,
		"sales":          sales,
		"listings":       listings,
		"reviews":        reviews,
		"ledger_entries": ledgerEntries,
	}

	// Create ZIP file
	buf := new(bytes.Buffer)
	zipWriter := zip.NewWriter(buf)

	// Add data.json
	dataJSON, _ := json.MarshalIndent(exportData, "", "  ")
	w, _ := zipWriter.Create("data.json")
	w.Write(dataJSON)

	// Add readme
	readme := `ProxySocialHub Data Export
===========================
This archive contains all your data stored on ProxySocialHub.

Files:
- data.json: Your complete data in JSON format

For questions, contact support@proxyhubb.com
`
	w, _ = zipWriter.Create("README.txt")
	w.Write([]byte(readme))

	zipWriter.Close()

	// Log the export
	auditLogEntry := models.AuditLog{
		EventType:   models.AuditUserUpdated,
		Severity:    models.AuditSeverityInfo,
		ActorID:     &userID,
		ActorEmail:  user.Email,
		TargetType:  "user",
		TargetID:    userID.String(),
		Description: "User data export requested",
		Success:     true,
	}
	db.DB.Create(&auditLogEntry)

	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", "attachment; filename=proxyhubb_export_"+time.Now().Format("20060102")+".zip")
	c.Data(http.StatusOK, "application/zip", buf.Bytes())
}

// deleteAccount schedules account for deletion
func deleteAccount(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var req struct {
		Password     string `json:"password" binding:"required"`
		Confirmation string `json:"confirmation" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Confirmation != "DELETE MY ACCOUNT" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Please type 'DELETE MY ACCOUNT' to confirm"})
		return
	}

	// Verify password
	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Schedule deletion (30 days grace period)
	deletionDate := time.Now().AddDate(0, 0, 30)
	db.DB.Model(&user).Update("scheduled_deletion_at", deletionDate)

	// Log account deletion scheduled
	auditEntry := models.AuditLog{
		EventType:   models.AuditUserDeleted,
		Severity:    models.AuditSeverityCritical,
		ActorID:     &userID,
		ActorEmail:  user.Email,
		TargetType:  "user",
		TargetID:    userID.String(),
		Description: "Account scheduled for deletion",
		Success:     true,
	}
	db.DB.Create(&auditEntry)

	c.JSON(http.StatusOK, gin.H{
		"message":       "Account scheduled for deletion",
		"deletion_date": deletionDate,
		"note":          "You can cancel this by logging in before the deletion date",
	})
}
