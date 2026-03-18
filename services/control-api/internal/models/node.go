package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Node represents a provider node in the network
type Node struct {
	ID                uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	ProviderUserID    uuid.UUID `gorm:"type:uuid;index" json:"provider_user_id"`
	IPAddress         string    `gorm:"type:varchar(45)" json:"ip_address"`
	Port              int       `json:"port"`
	Protocol          string    `gorm:"type:varchar(10);default:'http'" json:"protocol"`
	CountryCode       string    `gorm:"type:varchar(10)" json:"country_code"`
	Region            string    `gorm:"type:varchar(100)" json:"region"`
	City              string    `gorm:"type:varchar(100)" json:"city"`
	ISP               string    `gorm:"type:varchar(100)" json:"isp"`
	ConnectionType    string    `gorm:"type:varchar(50)" json:"connection_type"` // residential, mobile, datacenter
	IsHealthy         bool      `gorm:"default:true" json:"is_healthy"`
	ActiveConnections int       `json:"active_connections"`
	MaxConnections    int       `gorm:"default:100" json:"max_connections"`
	LatencyMs         int       `json:"latency_ms"`
	TotalBytesUp      int64     `json:"total_bytes_up"`
	TotalBytesDown    int64     `json:"total_bytes_down"`
	UptimePercent     float64   `gorm:"default:100" json:"uptime_percent"`
	SuccessRate       float64   `gorm:"default:1.0" json:"success_rate"`
	QualityScore      float64   `gorm:"default:100" json:"quality_score"`
	LastSeenAt        time.Time `json:"last_seen_at"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`

	// Gateway identity — stable across IP changes; used for deduplication on re-registration
	GatewayNodeID string `gorm:"type:varchar(128);index" json:"gateway_node_id,omitempty"`

	// On-Chain Registry
	IsRegisteredOnChain bool   `gorm:"default:false" json:"is_registered_on_chain"`
	NetUID              int    `json:"net_uid"`
	Hotkey              string `gorm:"size:64" json:"hotkey"` // The hotkey used to register this node

	// N-06: soft-delete — GORM automatically adds WHERE deleted_at IS NULL to all queries.
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

func (n *Node) BeforeCreate(tx *gorm.DB) (err error) {
	if n.ID == uuid.Nil {
		n.ID = uuid.New()
	}
	return
}

// CalculateQualityScore calculates a quality score based on various metrics
func (n *Node) CalculateQualityScore() float64 {
	score := 100.0

	// Penalize for high latency
	if n.LatencyMs > 100 {
		score -= float64(n.LatencyMs-100) * 0.1
	}

	// Penalize for low success rate
	score *= n.SuccessRate

	// Penalize for low uptime
	score *= (n.UptimePercent / 100)

	// Bonus for high bandwidth served
	totalGB := float64(n.TotalBytesUp+n.TotalBytesDown) / (1024 * 1024 * 1024)
	if totalGB > 10 {
		score += 5
	}
	if totalGB > 100 {
		score += 10
	}

	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}

	return score
}

// GetEarningsMultiplier returns earnings multiplier based on quality score
func (n *Node) GetEarningsMultiplier() float64 {
	score := n.QualityScore

	if score >= 95 {
		return 1.25 // 25% bonus
	}
	if score >= 85 {
		return 1.10 // 10% bonus
	}
	if score >= 75 {
		return 1.00 // Standard rate
	}
	if score >= 60 {
		return 0.85 // 15% penalty
	}
	return 0.70 // 30% penalty
}

// RegistryNode represents the node data stored on-chain in the Solana program
type RegistryNode struct {
	Pubkey        string  `json:"pubkey"`
	Owner         string  `json:"owner"`
	IPAddr        string  `json:"ip_address"`
	Port          int     `json:"port"`
	ProxyType     string  `json:"proxy_type"`
	StakedAmount  float64 `json:"staked_amount"`
	UptimePercent float64 `json:"uptime_percent"`
	QualityScore  float64 `json:"quality_score"`
	LastSeen      int64   `json:"last_seen"`
}
