package models

import (
	"math/rand"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// JuryStatus represents the state of a dispute jury
type JuryStatus string

const (
	JuryVoting   JuryStatus = "voting"   // Jurors are voting
	JuryReview   JuryStatus = "review"   // Under admin review
	JuryResolved JuryStatus = "resolved" // Decision made
	JuryAppealed JuryStatus = "appealed" // Decision appealed
	JuryExpired  JuryStatus = "expired"  // Voting period expired
)

// JuryVote represents a single vote
type JuryVote int

const (
	VotePending    JuryVote = 0
	VoteBuyerWins  JuryVote = 1
	VoteSellerWins JuryVote = 2
	VoteSplitFunds JuryVote = 3
)

// DisputeJury represents decentralized dispute resolution
type DisputeJury struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	DisputeID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_jury_dispute" json:"dispute_id"`
	EscrowID  uuid.UUID `gorm:"type:uuid;index" json:"escrow_id"`

	// Parties
	BuyerID  uuid.UUID `gorm:"type:uuid;not null" json:"buyer_id"`
	SellerID uuid.UUID `gorm:"type:uuid;not null" json:"seller_id"`

	// Jurors (selected from reputation-weighted validators)
	Juror1ID uuid.UUID  `gorm:"type:uuid;not null" json:"juror1_id"`
	Juror2ID uuid.UUID  `gorm:"type:uuid;not null" json:"juror2_id"`
	Juror3ID uuid.UUID  `gorm:"type:uuid;not null" json:"juror3_id"`
	Juror4ID *uuid.UUID `gorm:"type:uuid" json:"juror4_id,omitempty"`
	Juror5ID *uuid.UUID `gorm:"type:uuid" json:"juror5_id,omitempty"`

	// Votes (0=pending, 1=buyer, 2=seller, 3=split)
	Vote1 JuryVote `gorm:"default:0" json:"vote1"`
	Vote2 JuryVote `gorm:"default:0" json:"vote2"`
	Vote3 JuryVote `gorm:"default:0" json:"vote3"`
	Vote4 JuryVote `gorm:"default:0" json:"vote4"`
	Vote5 JuryVote `gorm:"default:0" json:"vote5"`

	// Vote timestamps
	Vote1At *time.Time `json:"vote1_at,omitempty"`
	Vote2At *time.Time `json:"vote2_at,omitempty"`
	Vote3At *time.Time `json:"vote3_at,omitempty"`
	Vote4At *time.Time `json:"vote4_at,omitempty"`
	Vote5At *time.Time `json:"vote5_at,omitempty"`

	// Dispute details
	DisputeReason  string  `gorm:"type:text;not null" json:"dispute_reason"`
	BuyerEvidence  string  `gorm:"type:text" json:"buyer_evidence"`
	SellerEvidence string  `gorm:"type:text" json:"seller_evidence"`
	DisputedAmount float64 `gorm:"not null" json:"disputed_amount"`

	// Outcome
	Status          JuryStatus `gorm:"type:varchar(20);default:'voting'" json:"status"`
	Decision        JuryVote   `gorm:"default:0" json:"decision"` // Final majority decision
	BuyerPayout     float64    `gorm:"default:0" json:"buyer_payout"`
	SellerPayout    float64    `gorm:"default:0" json:"seller_payout"`
	ResolutionNotes string     `gorm:"type:text" json:"resolution_notes"`

	// On-Chain
	OnChainTxHash string `gorm:"type:varchar(128)" json:"on_chain_tx_hash,omitempty"`
	OnChainSlot   int64  `json:"on_chain_slot,omitempty"`

	// Timing
	VotingDeadline time.Time  `json:"voting_deadline"`
	CreatedAt      time.Time  `json:"created_at"`
	ResolvedAt     *time.Time `json:"resolved_at,omitempty"`

	// Relations
	Buyer  *User `gorm:"foreignKey:BuyerID" json:"buyer,omitempty"`
	Seller *User `gorm:"foreignKey:SellerID" json:"seller,omitempty"`
	Juror1 *User `gorm:"foreignKey:Juror1ID" json:"juror1,omitempty"`
	Juror2 *User `gorm:"foreignKey:Juror2ID" json:"juror2,omitempty"`
	Juror3 *User `gorm:"foreignKey:Juror3ID" json:"juror3,omitempty"`
}

func (DisputeJury) TableName() string {
	return "dispute_juries"
}

func (d *DisputeJury) BeforeCreate(tx *gorm.DB) error {
	if d.ID == uuid.Nil {
		d.ID = uuid.New()
	}
	d.VotingDeadline = time.Now().Add(48 * time.Hour) // 48 hours to vote
	return nil
}

// GetVotes returns all votes as a slice
func (d *DisputeJury) GetVotes() []JuryVote {
	votes := []JuryVote{d.Vote1, d.Vote2, d.Vote3}
	if d.Juror4ID != nil {
		votes = append(votes, d.Vote4)
	}
	if d.Juror5ID != nil {
		votes = append(votes, d.Vote5)
	}
	return votes
}

// GetJurorCount returns number of jurors assigned
func (d *DisputeJury) GetJurorCount() int {
	count := 3
	if d.Juror4ID != nil {
		count++
	}
	if d.Juror5ID != nil {
		count++
	}
	return count
}

// GetVoteCount returns votes cast so far
func (d *DisputeJury) GetVoteCount() int {
	count := 0
	for _, v := range d.GetVotes() {
		if v != VotePending {
			count++
		}
	}
	return count
}

// GetMajority calculates the majority decision
func (d *DisputeJury) GetMajority() (JuryVote, bool) {
	voteCounts := make(map[JuryVote]int)
	totalJurors := d.GetJurorCount()

	for _, v := range d.GetVotes() {
		if v != VotePending {
			voteCounts[v]++
		}
	}

	// Need > 50% for majority
	threshold := totalJurors / 2

	for vote, count := range voteCounts {
		if count > threshold {
			return vote, true
		}
	}

	return VotePending, false
}

// CanAutoResolve checks if majority is reached
func (d *DisputeJury) CanAutoResolve() bool {
	_, hasMajority := d.GetMajority()
	return hasMajority
}

// Resolve finalizes the jury decision
func (d *DisputeJury) Resolve() {
	decision, hasMajority := d.GetMajority()
	if !hasMajority {
		d.Status = JuryReview // Need admin review
		return
	}

	d.Decision = decision
	d.Status = JuryResolved
	now := time.Now()
	d.ResolvedAt = &now

	// Calculate payouts
	switch decision {
	case VoteBuyerWins:
		d.BuyerPayout = d.DisputedAmount
		d.SellerPayout = 0
	case VoteSellerWins:
		d.BuyerPayout = 0
		d.SellerPayout = d.DisputedAmount
	case VoteSplitFunds:
		d.BuyerPayout = d.DisputedAmount / 2
		d.SellerPayout = d.DisputedAmount / 2
	}
}

// IsJuror checks if a user is a juror for this dispute
func (d *DisputeJury) IsJuror(userID uuid.UUID) bool {
	if d.Juror1ID == userID || d.Juror2ID == userID || d.Juror3ID == userID {
		return true
	}
	if d.Juror4ID != nil && *d.Juror4ID == userID {
		return true
	}
	if d.Juror5ID != nil && *d.Juror5ID == userID {
		return true
	}
	return false
}

// GetJurorSlot returns which juror slot a user occupies (1-5)
func (d *DisputeJury) GetJurorSlot(userID uuid.UUID) int {
	if d.Juror1ID == userID {
		return 1
	}
	if d.Juror2ID == userID {
		return 2
	}
	if d.Juror3ID == userID {
		return 3
	}
	if d.Juror4ID != nil && *d.Juror4ID == userID {
		return 4
	}
	if d.Juror5ID != nil && *d.Juror5ID == userID {
		return 5
	}
	return 0
}

// SelectJurors selects jurors from eligible validators (reputation-weighted)
func SelectJurors(db *gorm.DB, excludeBuyer, excludeSeller uuid.UUID, count int) ([]uuid.UUID, error) {
	var validators []Validator

	// Get active validators with good trust scores, excluding parties
	err := db.Where("status = ? AND trust_score >= ? AND user_id NOT IN ?",
		ValidatorActive, 50, []uuid.UUID{excludeBuyer, excludeSeller}).
		Order("trust_score DESC, total_attestations DESC").
		Limit(count * 3). // Get 3x candidates for selection
		Find(&validators).Error

	if err != nil {
		return nil, err
	}

	if len(validators) < count {
		// Not enough validators, return what we have
		jurors := make([]uuid.UUID, len(validators))
		for i, v := range validators {
			jurors[i] = v.UserID
		}
		return jurors, nil
	}

	// Reputation-weighted random selection
	// Higher trust score = higher probability of selection
	selected := make(map[uuid.UUID]bool)
	jurors := make([]uuid.UUID, 0, count)

	for len(jurors) < count {
		// Weight by trust score
		totalWeight := 0.0
		for _, v := range validators {
			if !selected[v.UserID] {
				totalWeight += v.TrustScore
			}
		}

		// Random selection based on weight
		r := rand.Float64() * totalWeight
		cumulative := 0.0

		for _, v := range validators {
			if selected[v.UserID] {
				continue
			}
			cumulative += v.TrustScore
			if cumulative >= r {
				selected[v.UserID] = true
				jurors = append(jurors, v.UserID)
				break
			}
		}
	}

	return jurors, nil
}

// CreateDisputeJuryRequest for API binding
type CreateDisputeJuryRequest struct {
	DisputeReason  string  `json:"dispute_reason" binding:"required"`
	BuyerEvidence  string  `json:"buyer_evidence"`
	SellerEvidence string  `json:"seller_evidence"`
	DisputedAmount float64 `json:"disputed_amount" binding:"required,min=0"`
}

// CastVoteRequest for API binding
type CastVoteRequest struct {
	Vote JuryVote `json:"vote" binding:"required,min=1,max=3"`
}

// JurySubmitEvidenceRequest for API binding
type JurySubmitEvidenceRequest struct {
	Evidence string `json:"evidence" binding:"required"`
}
