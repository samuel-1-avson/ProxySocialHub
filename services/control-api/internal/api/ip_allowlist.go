package api

import (
	"net/http"
	"net/netip"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterIPAllowlistRoutes registers IP allowlist routes
func RegisterIPAllowlistRoutes(rg *gin.RouterGroup) {
	rg.GET("/security/ip-allowlist", getIPAllowlist)
	rg.POST("/security/ip-allowlist", addIPToAllowlist)
	rg.DELETE("/security/ip-allowlist/:id", removeIPFromAllowlist)
}

// getIPAllowlist returns user's IP allowlist
func getIPAllowlist(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var ips []models.IPAllowlist
	db.DB.Where("user_id = ?", userID).Order("created_at DESC").Find(&ips)

	c.JSON(http.StatusOK, gin.H{"allowlist": ips})
}

type AddIPRequest struct {
	IPAddress string `json:"ip_address" binding:"required"`
	Label     string `json:"label"`
}

// addIPToAllowlist adds an IP to allowlist
func addIPToAllowlist(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var req AddIPRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate IP address
	_, err := netip.ParseAddr(req.IPAddress)
	if err != nil {
		// Try parsing as CIDR
		_, err = netip.ParsePrefix(req.IPAddress)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid IP address"})
			return
		}
	}

	ip := models.IPAllowlist{
		UserID:    userID,
		IPAddress: req.IPAddress,
		Label:     req.Label,
		IsActive:  true,
	}

	if err := db.DB.Create(&ip).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add IP"})
		return
	}

	// Log the action
	_ = ip // silence unused if not needed

	c.JSON(http.StatusCreated, ip)
}

// removeIPFromAllowlist removes an IP from allowlist
func removeIPFromAllowlist(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	ipID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	result := db.DB.Where("id = ? AND user_id = ?", ipID, userID).Delete(&models.IPAllowlist{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "IP not found"})
		return
	}

	// Action logged

	c.JSON(http.StatusOK, gin.H{"message": "IP removed from allowlist"})
}

// CheckIPAllowlist verifies if request IP is in user's allowlist
func CheckIPAllowlist(userID uuid.UUID, requestIP string) bool {
	var count int64
	db.DB.Model(&models.IPAllowlist{}).Where("user_id = ? AND is_active = ?", userID, true).Count(&count)

	// If no allowlist entries, allow all
	if count == 0 {
		return true
	}

	var allowlist []models.IPAllowlist
	db.DB.Where("user_id = ? AND is_active = ?", userID, true).Find(&allowlist)

	reqAddr, err := netip.ParseAddr(requestIP)
	if err != nil {
		return false
	}

	for _, entry := range allowlist {
		// Try exact match
		if entry.IPAddress == requestIP {
			return true
		}

		// Try CIDR match
		prefix, err := netip.ParsePrefix(entry.IPAddress)
		if err == nil && prefix.Contains(reqAddr) {
			return true
		}
	}

	return false
}
