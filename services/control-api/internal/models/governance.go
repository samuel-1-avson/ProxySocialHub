package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ProposalStatus string

const (
	ProposalActive   ProposalStatus = "active"
	ProposalPassed   ProposalStatus = "passed"
	ProposalRejected ProposalStatus = "rejected"
	ProposalExecuted ProposalStatus = "executed"
)

// ProposalType defines the category of proposal
type ProposalType string

const (
	ProposalTypeGeneral   ProposalType = "general"   // Discussion/advisory
	ProposalTypeTreasury  ProposalType = "treasury"  // Fund allocation
	ProposalTypeParameter ProposalType = "parameter" // Protocol parameters
	ProposalTypeSlash     ProposalType = "slash"     // Gateway slashing
	ProposalTypeUpgrade   ProposalType = "upgrade"   // Contract upgrades
)

// Proposal represents a governance proposal
type Proposal struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Title       string         `gorm:"type:varchar(255);not null" json:"title"`
	Description string         `gorm:"type:text;not null" json:"description"`
	ProposerID  uuid.UUID      `gorm:"type:uuid;not null" json:"proposer_id"`
	Type        ProposalType   `gorm:"type:varchar(50);default:'general'" json:"type"`
	StartTime   time.Time      `gorm:"not null" json:"start_time"`
	EndTime     time.Time      `gorm:"not null" json:"end_time"`
	Status      ProposalStatus `gorm:"type:varchar(50);default:'active'" json:"status"`

	// Execution data (JSON payload for treasury/parameter/slash/upgrade)
	ExecutionData string `gorm:"type:text" json:"execution_data,omitempty"`

	// Quorum requirement (minimum total votes needed)
	Quorum float64 `gorm:"default:100" json:"quorum"`

	// Decentralized Storage (explicit column names — GORM would map IPFSHash to ip_fs_hash)
	IPFSHash    string `gorm:"column:ipfs_hash;type:varchar(100)" json:"ipfs_hash"`
	ArweaveTxID string `gorm:"column:arweave_tx_id;type:varchar(64)" json:"arweave_tx_id,omitempty"`

	// On-chain PDA (base58) when created via chain-authoritative flow
	OnChainPDA string `gorm:"column:onchain_pda;type:varchar(64)" json:"onchain_pda,omitempty"`

	// Vote Counts (Cached)
	YesVotes float64 `gorm:"default:0" json:"yes_votes"`
	NoVotes  float64 `gorm:"default:0" json:"no_votes"`

	// Link to discussion
	ThreadID *uuid.UUID `gorm:"type:uuid" json:"thread_id,omitempty"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	Proposer *User        `gorm:"foreignKey:ProposerID" json:"proposer,omitempty"`
	Thread   *ForumThread `gorm:"foreignKey:ThreadID" json:"thread,omitempty"`
}

func (Proposal) TableName() string {
	return "governance_proposals"
}

func (p *Proposal) BeforeCreate(tx *gorm.DB) (err error) {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return
}

// Vote represents a user's vote on a proposal
type Vote struct {
	ID         uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	ProposalID uuid.UUID `gorm:"type:uuid;not null;index" json:"proposal_id"`
	VoterID    uuid.UUID `gorm:"type:uuid;not null;index" json:"voter_id"`
	Choice     string    `gorm:"column:vote;type:varchar(10);not null" json:"choice"` // "yes", "no", "abstain"
	Power      float64   `gorm:"column:weight;not null" json:"power"`                 // Voting power at time of vote
	CreatedAt  time.Time `json:"created_at"`

	Voter *User `gorm:"foreignKey:VoterID" json:"voter,omitempty"`
}

func (Vote) TableName() string {
	return "governance_votes"
}

func (v *Vote) BeforeCreate(tx *gorm.DB) (err error) {
	if v.ID == uuid.Nil {
		v.ID = uuid.New()
	}
	return
}

// TreasuryTransaction tracks fund transfers from DAO treasury
type TreasuryTransaction struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	ProposalID  uuid.UUID `gorm:"type:uuid;not null" json:"proposal_id"`
	Recipient   string    `gorm:"type:varchar(64);not null" json:"recipient"`
	Amount      float64   `gorm:"not null" json:"amount"`
	Currency    string    `gorm:"type:varchar(10);not null" json:"currency"`
	Description string    `gorm:"type:text" json:"description"`
	Status      string    `gorm:"type:varchar(20);default:'pending'" json:"status"`
	TxHash      string    `gorm:"type:varchar(128)" json:"tx_hash,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	ExecutedAt  time.Time `json:"executed_at,omitempty"`
}

func (TreasuryTransaction) TableName() string {
	return "treasury_transactions"
}

// ProtocolParameter stores configurable protocol parameters
type ProtocolParameter struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Name      string    `gorm:"type:varchar(100);uniqueIndex;not null" json:"name"`
	Value     string    `gorm:"type:text;not null" json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ProtocolParameter) TableName() string {
	return "protocol_parameters"
}

// ParameterAudit logs changes to protocol parameters
type ParameterAudit struct {
	ID         uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Parameter  string    `gorm:"type:varchar(100);not null;index" json:"parameter"`
	OldValue   string    `gorm:"type:text" json:"old_value"`
	NewValue   string    `gorm:"type:text" json:"new_value"`
	Reason     string    `gorm:"type:text" json:"reason"`
	ProposalID uuid.UUID `gorm:"type:uuid" json:"proposal_id"`
	ChangedAt  time.Time `json:"changed_at"`
}

func (ParameterAudit) TableName() string {
	return "parameter_audits"
}

// SlashingEvent records gateway slashing events
type SlashingEvent struct {
	ID              uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	ProposalID      uuid.UUID `gorm:"type:uuid" json:"proposal_id"`
	GatewayAddress  string    `gorm:"type:varchar(64);not null;index" json:"gateway_address"`
	SlashPercentage uint8     `gorm:"not null" json:"slash_percentage"`
	Reason          string    `gorm:"type:text" json:"reason"`
	Evidence        string    `gorm:"type:varchar(100)" json:"evidence"` // IPFS CID
	TxHash          string    `gorm:"type:varchar(128)" json:"tx_hash,omitempty"`
	ExecutedAt      time.Time `json:"executed_at"`
}

func (SlashingEvent) TableName() string {
	return "slashing_events"
}

// PendingUpgrade tracks scheduled protocol upgrades
type PendingUpgrade struct {
	ID              uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	ProposalID      uuid.UUID `gorm:"type:uuid;not null" json:"proposal_id"`
	ProgramID       string    `gorm:"type:varchar(64);not null" json:"program_id"`
	NewVersion      string    `gorm:"type:varchar(128);not null" json:"new_version"`
	ChangelogCID    string    `gorm:"type:varchar(100)" json:"changelog_cid"`
	RollbackPlanCID string    `gorm:"type:varchar(100)" json:"rollback_plan_cid"`
	ScheduledAt     time.Time `gorm:"not null" json:"scheduled_at"`
	ExecutedAt      time.Time `json:"executed_at,omitempty"`
	Status          string    `gorm:"type:varchar(20);default:'scheduled'" json:"status"`
	CreatedAt       time.Time `json:"created_at"`
}

func (PendingUpgrade) TableName() string {
	return "pending_upgrades"
}
