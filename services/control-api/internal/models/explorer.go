package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ExplorerBlock represents a cached block from the blockchain
type ExplorerBlock struct {
	ID               uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	BlockHash        string    `gorm:"type:varchar(128);uniqueIndex" json:"block_hash"`
	BlockNumber      uint64    `gorm:"uniqueIndex" json:"block_number"`
	Chain            string    `gorm:"type:varchar(20);default:'solana'" json:"chain"` // "solana", "ethereum"
	ParentHash       string    `gorm:"type:varchar(128)" json:"parent_hash"`
	Timestamp        time.Time `json:"timestamp"`
	TransactionCount int       `json:"transaction_count"`
	ValidatorPubkey  string    `gorm:"type:varchar(128)" json:"validator_pubkey,omitempty"`
	Slot             uint64    `json:"slot,omitempty"` // Solana-specific
	// P3-06: true when this block was replaced by a canonical fork.
	IsOrphaned       bool      `gorm:"default:false" json:"is_orphaned"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// ExplorerTransaction represents a cached transaction from the blockchain
type ExplorerTransaction struct {
	ID            uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	TxHash        string    `gorm:"type:varchar(128);uniqueIndex" json:"tx_hash"`
	Chain         string    `gorm:"type:varchar(20);default:'solana'" json:"chain"`
	BlockHash     string    `gorm:"type:varchar(128);index" json:"block_hash"`
	BlockNumber   uint64    `gorm:"index" json:"block_number"`
	FromAddress   string    `gorm:"type:varchar(128);index" json:"from_address"`
	ToAddress     string    `gorm:"type:varchar(128);index" json:"to_address"`
	Amount        float64   `gorm:"type:numeric(20,8)" json:"amount"`
	Currency      string    `gorm:"type:varchar(20);default:'SOL'" json:"currency"` // "SOL" or SPL token symbol
	// P3-05: SPL token support — mint address when currency is an SPL token.
	TokenMint     string    `gorm:"type:varchar(128)" json:"token_mint,omitempty"`
	// P3-06: set true when the block this tx belongs to is orphaned.
	IsOrphaned    bool      `gorm:"default:false" json:"is_orphaned"`
	Fee           float64   `gorm:"type:numeric(20,8)" json:"fee"`
	Status        string    `gorm:"type:varchar(20)" json:"status"`                // "confirmed", "pending", "failed"
	TxType        string    `gorm:"type:varchar(50)" json:"tx_type"`               // "transfer", "escrow_init", "escrow_settle", "stake", "unstake"
	ProgramID     string    `gorm:"type:varchar(128)" json:"program_id,omitempty"` // Solana program
	Timestamp     time.Time `gorm:"index" json:"timestamp"`
	Confirmations int       `json:"confirmations"`
	RawData       string    `gorm:"type:text" json:"raw_data,omitempty"` // JSON-encoded raw tx data
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// ExplorerNode represents a cached node/validator from the network
type ExplorerNode struct {
	ID             uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	NodeID         string    `gorm:"type:varchar(128);uniqueIndex" json:"node_id"` // Solana/Ethereum address
	Chain          string    `gorm:"type:varchar(20)" json:"chain"`
	Name           string    `gorm:"type:varchar(255)" json:"name,omitempty"`
	IP             string    `gorm:"type:varchar(45)" json:"-"` // Hidden for privacy, only show region
	Region         string    `gorm:"type:varchar(50)" json:"region"`
	Country        string    `gorm:"type:varchar(50)" json:"country"`
	City           string    `gorm:"type:varchar(100)" json:"city,omitempty"`
	ISP            string    `gorm:"type:varchar(200)" json:"isp,omitempty"`
	Latitude       float64   `gorm:"type:numeric(10,6);default:0" json:"latitude"`
	Longitude      float64   `gorm:"type:numeric(10,6);default:0" json:"longitude"`
	IsActive       bool      `gorm:"default:true" json:"is_active"`
	IsValidator    bool      `gorm:"default:false" json:"is_validator"`
	StakeAmount    float64   `gorm:"type:numeric(20,8)" json:"stake_amount"`
	CommissionRate float64   `gorm:"type:numeric(5,2)" json:"commission_rate"`
	UptimePercent  float64   `gorm:"type:numeric(5,2)" json:"uptime_percent"`
	TotalBandwidth uint64    `json:"total_bandwidth_bytes"`
	ActiveSessions int       `json:"active_sessions"`
	LastHeartbeat  time.Time `json:"last_heartbeat"`
	Version        string    `gorm:"type:varchar(50)" json:"version,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// ExplorerContract represents a registered smart contract
type ExplorerContract struct {
	ID              uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	Address         string    `gorm:"type:varchar(128);uniqueIndex" json:"address"`
	Chain           string    `gorm:"type:varchar(20)" json:"chain"`
	Name            string    `gorm:"type:varchar(255)" json:"name"`
	ContractType    string    `gorm:"type:varchar(50)" json:"contract_type"` // "escrow", "session", "token", "custom"
	IsVerified      bool      `gorm:"default:false" json:"is_verified"`
	SourceCodeHash  string    `gorm:"type:varchar(128)" json:"source_code_hash,omitempty"`
	DeployTxHash    string    `gorm:"type:varchar(128)" json:"deploy_tx_hash"`
	DeployerAddress string    `gorm:"type:varchar(128)" json:"deployer_address"`
	TotalCalls      uint64    `json:"total_calls"`
	TotalVolume     float64   `gorm:"type:numeric(30,8)" json:"total_volume"`
	DeployedAt      time.Time `json:"deployed_at"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// ExplorerMetrics represents aggregated network metrics
type ExplorerMetrics struct {
	ID                  uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	Chain               string    `gorm:"type:varchar(20);uniqueIndex:idx_chain_period" json:"chain"`
	Period              string    `gorm:"type:varchar(20);uniqueIndex:idx_chain_period" json:"period"` // "hourly", "daily", "weekly"
	PeriodStart         time.Time `gorm:"uniqueIndex:idx_chain_period" json:"period_start"`
	TotalTransactions   uint64    `json:"total_transactions"`
	TotalVolume         float64   `gorm:"type:numeric(30,8)" json:"total_volume"`
	ActiveWallets       uint64    `json:"active_wallets"`
	ActiveNodes         uint64    `json:"active_nodes"`
	AverageBlockTime    float64   `gorm:"type:numeric(10,4)" json:"average_block_time_ms"`
	TotalBandwidthBytes uint64    `json:"total_bandwidth_bytes"`
	TotalFees           float64   `gorm:"type:numeric(20,8)" json:"total_fees"`
	AvgTxFee            float64   `gorm:"type:numeric(20,8)" json:"avg_tx_fee"`
	CreatedAt           time.Time `json:"created_at"`
}

func (b *ExplorerBlock) BeforeCreate(tx *gorm.DB) (err error) {
	if b.ID == uuid.Nil {
		b.ID = uuid.New()
	}
	return
}

func (t *ExplorerTransaction) BeforeCreate(tx *gorm.DB) (err error) {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	return
}

func (n *ExplorerNode) BeforeCreate(tx *gorm.DB) (err error) {
	if n.ID == uuid.Nil {
		n.ID = uuid.New()
	}
	return
}

func (c *ExplorerContract) BeforeCreate(tx *gorm.DB) (err error) {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return
}

func (m *ExplorerMetrics) BeforeCreate(tx *gorm.DB) (err error) {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return
}
