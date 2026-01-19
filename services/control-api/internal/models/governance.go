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

// Proposal represents a governance proposal
type Proposal struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Title       string         `gorm:"type:varchar(255);not null" json:"title"`
	Description string         `gorm:"type:text;not null" json:"description"`
	ProposerID  uuid.UUID      `gorm:"type:uuid;not null" json:"proposer_id"`
	StartTime   time.Time      `gorm:"not null" json:"start_time"`
	EndTime     time.Time      `gorm:"not null" json:"end_time"`
	Status      ProposalStatus `gorm:"type:varchar(50);default:'active'" json:"status"`

	// Decentralized Storage
	IPFSHash string `gorm:"type:varchar(100)" json:"ipfs_hash"`

	// Vote Counts (Cached)
	YesVotes float64 `gorm:"default:0" json:"yes_votes"`
	NoVotes  float64 `gorm:"default:0" json:"no_votes"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	Proposer *User `gorm:"foreignKey:ProposerID" json:"proposer,omitempty"`
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
	Choice     string    `gorm:"type:varchar(10);not null" json:"choice"` // "yes", "no", "abstain"
	Power      float64   `gorm:"not null" json:"power"`                   // Voting power (TAO Balance) at time of vote
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
