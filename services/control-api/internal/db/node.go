package db

import (
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
)

// NodeExists checks if a node with the given hotkey/pubkey exists in the database
func NodeExists(pubkey string) (bool, error) {
	var count int64
	err := DB.Model(&models.Node{}).Where("hotkey = ?", pubkey).Count(&count).Error
	return count > 0, err
}

// CreateNodeFromRegistry provisions a new local node record from on-chain data
func CreateNodeFromRegistry(rn models.RegistryNode) error {
	node := models.Node{
		ID:                  uuid.New(),
		IPAddress:           rn.IPAddr,
		Port:                rn.Port,
		ConnectionType:      rn.ProxyType,
		IsRegisteredOnChain: true,
		Hotkey:              rn.Pubkey,
		UptimePercent:       rn.UptimePercent,
		QualityScore:        rn.QualityScore,
		LastSeenAt:          time.Unix(rn.LastSeen, 0),
		CreatedAt:           time.Now(),
		UpdatedAt:           time.Now(),
	}

	return DB.Create(&node).Error
}

// UpdateNodeFromRegistry updates an existing local node record from on-chain data
func UpdateNodeFromRegistry(rn models.RegistryNode) error {
	return DB.Model(&models.Node{}).Where("hotkey = ?", rn.Pubkey).Updates(map[string]interface{}{
		"ip_address":     rn.IPAddr,
		"port":           rn.Port,
		"uptime_percent": rn.UptimePercent,
		"quality_score":  rn.QualityScore,
		"last_seen_at":   time.Unix(rn.LastSeen, 0),
		"updated_at":     time.Now(),
	}).Error
}
