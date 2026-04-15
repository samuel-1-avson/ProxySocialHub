package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/providerlease"
)

type issueProviderLeaseRequest struct {
	ConnectionType    string   `json:"connection_type" binding:"required"`
	AvailablePorts    []uint16 `json:"available_ports"`
	MaxConnections    uint32   `json:"max_connections" binding:"required"`
	MaxBandwidthMbps  uint32   `json:"max_bandwidth_mbps" binding:"required"`
	UplinkSpeedKbps   uint32   `json:"uplink_speed_kbps"`
	DownlinkSpeedKbps uint32   `json:"downlink_speed_kbps"`
	CPUCores          uint32   `json:"cpu_cores"`
	MemoryMB          uint32   `json:"memory_mb"`
	OS                string   `json:"os"`
	ClientVersion     string   `json:"client_version"`
	Features          []string `json:"features"`
}

func RegisterProviderLeaseRoutes(rg *gin.RouterGroup) {
	rg.POST("/provider/lease", issueProviderLease)
}

func issueProviderLease(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var req issueProviderLeaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	secret, err := providerlease.ResolveSigningSecret()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Provider lease signing is not configured"})
		return
	}

	token, claims, err := providerlease.Issue(secret, providerlease.Params{
		UserID:            userID,
		ConnectionType:    req.ConnectionType,
		AvailablePorts:    req.AvailablePorts,
		MaxConnections:    req.MaxConnections,
		MaxBandwidthMbps:  req.MaxBandwidthMbps,
		UplinkSpeedKbps:   req.UplinkSpeedKbps,
		DownlinkSpeedKbps: req.DownlinkSpeedKbps,
		CPUCores:          req.CPUCores,
		MemoryMB:          req.MemoryMB,
		OS:                req.OS,
		ClientVersion:     req.ClientVersion,
		Features:          req.Features,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to issue provider lease"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":            token,
		"expires_at":       claims.ExpiresAt.Time,
		"expires_in":       int(providerlease.ResolveTTL().Seconds()),
		"renew_after_secs": providerlease.DefaultRenewAfterSeconds(),
		"lease": gin.H{
			"lease_id":            claims.ID,
			"user_id":             claims.UserID,
			"connection_type":     claims.ConnectionType,
			"available_ports":     claims.AvailablePorts,
			"max_connections":     claims.MaxConnections,
			"max_bandwidth_mbps":  claims.MaxBandwidthMbps,
			"uplink_speed_kbps":   claims.UplinkSpeedKbps,
			"downlink_speed_kbps": claims.DownlinkSpeedKbps,
			"cpu_cores":           claims.CPUCores,
			"memory_mb":           claims.MemoryMB,
			"os":                  claims.OS,
			"client_version":      claims.ClientVersion,
			"features":            claims.Features,
		},
	})
}
