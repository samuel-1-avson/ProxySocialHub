package governance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
)

// ErrTreasuryAwaitingCustody is returned when a treasury proposal is queued for
// manual/multisig custody instead of auto-spending from the hot wallet.
var ErrTreasuryAwaitingCustody = errors.New("treasury transfer queued for custody; automatic hot-wallet spend is disabled")

// ProposalExecutor handles execution of passed proposals
type ProposalExecutor struct {
	ctx context.Context
}

// NewProposalExecutor creates a new executor
func NewProposalExecutor() *ProposalExecutor {
	return &ProposalExecutor{
		ctx: context.Background(),
	}
}

// TreasuryTransfer represents a treasury transfer proposal payload
type TreasuryTransfer struct {
	Recipient   string  `json:"recipient"` // Wallet address
	Amount      float64 `json:"amount"`    // Amount in SOL/USDC
	Currency    string  `json:"currency"`  // "SOL", "USDC", "TAO"
	Description string  `json:"description"`
}

// ParameterChange represents a protocol parameter change
type ParameterChange struct {
	Parameter string      `json:"parameter"` // e.g., "platform_fee", "min_stake"
	OldValue  interface{} `json:"old_value"`
	NewValue  interface{} `json:"new_value"`
	Reason    string      `json:"reason"`
}

// GatewaySlash represents a gateway slashing proposal
type GatewaySlash struct {
	GatewayAddress  string `json:"gateway_address"`
	SlashPercentage uint8  `json:"slash_percentage"` // 0-100
	Reason          string `json:"reason"`
	Evidence        string `json:"evidence"` // IPFS CID of evidence
}

// UpgradeProposal represents a protocol upgrade
type UpgradeProposal struct {
	ProgramID       string `json:"program_id"`     // Program to upgrade
	NewVersion      string `json:"new_version"`    // New version hash
	ChangelogCID    string `json:"changelog_cid"`  // IPFS CID of changelog
	TimelockHours   int    `json:"timelock_hours"` // Hours before execution
	RollbackPlanCID string `json:"rollback_plan_cid"`
}

// ExecuteProposal executes a passed proposal based on its type
func (e *ProposalExecutor) ExecuteProposal(proposal models.Proposal) error {
	if proposal.Status != models.ProposalPassed {
		return fmt.Errorf("proposal must be in 'passed' status to execute")
	}

	logging.Info().
		Str("proposal_id", proposal.ID.String()).
		Str("type", string(proposal.Type)).
		Msg("Executing proposal")

	var err error

	switch proposal.Type {
	case models.ProposalTypeTreasury:
		err = e.executeTreasuryTransfer(proposal)
	case models.ProposalTypeParameter:
		err = e.executeParameterChange(proposal)
	case models.ProposalTypeSlash:
		err = e.executeSlashing(proposal)
	case models.ProposalTypeUpgrade:
		err = e.executeUpgrade(proposal)
	case models.ProposalTypeGeneral:
		// General proposals don't have automatic execution
		err = nil
	default:
		err = fmt.Errorf("unknown proposal type: %s", proposal.Type)
	}

	if err != nil {
		logging.Error(err).Str("proposal_id", proposal.ID.String()).Msg("Proposal execution failed")
		return err
	}

	// Mark as executed
	if updateErr := db.DB.Model(&proposal).Update("status", models.ProposalExecuted).Error; updateErr != nil {
		logging.Error(updateErr).Msg("Failed to update proposal status to executed")
		return updateErr
	}

	logging.Info().Str("proposal_id", proposal.ID.String()).Msg("Proposal executed successfully")
	return nil
}

// executeTreasuryTransfer queues a treasury transfer for custody review.
//
// Automatic hot-wallet SendSOL from governance is disabled: a compromised
// control-api/oracle must not be able to drain operational treasury via a
// passed proposal. Records are created as pending_custody for multisig/ops.
func (e *ProposalExecutor) executeTreasuryTransfer(proposal models.Proposal) error {
	var transfer TreasuryTransfer
	if err := json.Unmarshal([]byte(proposal.ExecutionData), &transfer); err != nil {
		return fmt.Errorf("failed to parse treasury transfer data: %w", err)
	}

	logging.Warn().
		Str("recipient", transfer.Recipient).
		Float64("amount", transfer.Amount).
		Str("currency", transfer.Currency).
		Str("proposal_id", proposal.ID.String()).
		Msg("Treasury auto-spend disabled — queuing pending_custody record")

	txRecord := models.TreasuryTransaction{
		ProposalID:  proposal.ID,
		Recipient:   transfer.Recipient,
		Amount:      transfer.Amount,
		Currency:    transfer.Currency,
		Description: transfer.Description,
		Status:      "pending_custody",
		CreatedAt:   time.Now(),
	}
	if err := db.DB.Create(&txRecord).Error; err != nil {
		return fmt.Errorf("failed to create treasury transaction record: %w", err)
	}

	return ErrTreasuryAwaitingCustody
}

// executeParameterChange updates protocol parameters
func (e *ProposalExecutor) executeParameterChange(proposal models.Proposal) error {
	var change ParameterChange
	if err := json.Unmarshal([]byte(proposal.ExecutionData), &change); err != nil {
		return fmt.Errorf("failed to parse parameter change data: %w", err)
	}

	logging.Info().
		Str("parameter", change.Parameter).
		Interface("old_value", change.OldValue).
		Interface("new_value", change.NewValue).
		Msg("Executing parameter change")

	// Update parameter in database
	param := models.ProtocolParameter{
		Name:      change.Parameter,
		Value:     fmt.Sprintf("%v", change.NewValue),
		UpdatedAt: time.Now(),
	}

	result := db.DB.Where("name = ?", change.Parameter).Assign(param).FirstOrCreate(&param)
	if result.Error != nil {
		return fmt.Errorf("failed to update parameter: %w", result.Error)
	}

	// Log the change for audit
	audit := models.ParameterAudit{
		Parameter:  change.Parameter,
		OldValue:   fmt.Sprintf("%v", change.OldValue),
		NewValue:   fmt.Sprintf("%v", change.NewValue),
		Reason:     change.Reason,
		ProposalID: proposal.ID,
		ChangedAt:  time.Now(),
	}
	db.DB.Create(&audit)

	return nil
}

// executeSlashing slashes a misbehaving gateway/provider on-chain.
//
// D-G2: Slashing now calls the Solana reputation program directly so that stake
// is removed on-chain and cannot be disputed by the slashed party.  The DB
// record is written regardless, serving as an audit log.
func (e *ProposalExecutor) executeSlashing(proposal models.Proposal) error {
	var slash GatewaySlash
	if err := json.Unmarshal([]byte(proposal.ExecutionData), &slash); err != nil {
		return fmt.Errorf("failed to parse slashing data: %w", err)
	}

	logging.Warn().
		Str("gateway", slash.GatewayAddress).
		Uint8("percentage", slash.SlashPercentage).
		Str("reason", slash.Reason).
		Msg("Executing on-chain gateway slashing")

	slashRecord := models.SlashingEvent{
		ProposalID:      proposal.ID,
		GatewayAddress:  slash.GatewayAddress,
		SlashPercentage: slash.SlashPercentage,
		Reason:          slash.Reason,
		Evidence:        slash.Evidence,
		ExecutedAt:      time.Now(),
	}
	if err := db.DB.Create(&slashRecord).Error; err != nil {
		return fmt.Errorf("failed to record slashing event: %w", err)
	}

	// Call the Solana reputation program to slash the provider's stake.
	oracle := solanaClient.GetOracleClient()
	if oracle == nil {
		logging.Warn().Msg("Oracle client not available — slashing recorded in DB only (no on-chain execution)")
		return nil
	}

	providerKey, err := sol.PublicKeyFromBase58(slash.GatewayAddress)
	if err != nil {
		return fmt.Errorf("invalid gateway address %q: %w", slash.GatewayAddress, err)
	}

	// Fetch provider's staked SOL from the node record (StakedAmountSOL).
	var node models.Node
	if err := db.DB.Where("hotkey = ? OR gateway_node_id = ?", slash.GatewayAddress, slash.GatewayAddress).
		First(&node).Error; err != nil {
		logging.Warn().Str("address", slash.GatewayAddress).Msg("Node not found in DB — skipping on-chain slash")
		return nil
	}

	// slash_percentage of the provider's staked SOL → lamports
	slashLamports := models.SOLToLamports(node.StakedAmountSOL * float64(slash.SlashPercentage) / 100.0)
	if slashLamports == 0 {
		logging.Warn().Msg("Calculated slash amount is zero — skipping on-chain call")
		return nil
	}

	txHash, err := oracle.SlashStake(e.ctx, solanaClient.SlashStakeParams{
		ProviderWallet: providerKey,
		Amount:         slashLamports,
	})
	if err != nil {
		return fmt.Errorf("on-chain slash failed: %w", err)
	}

	db.DB.Model(&slashRecord).Update("tx_signature", txHash)
	logging.Warn().
		Str("tx_hash", txHash).
		Str("gateway", slash.GatewayAddress).
		Uint64("lamports_slashed", slashLamports).
		Msg("On-chain slash executed successfully")

	return nil
}

// executeUpgrade schedules a protocol upgrade
func (e *ProposalExecutor) executeUpgrade(proposal models.Proposal) error {
	var upgrade UpgradeProposal
	if err := json.Unmarshal([]byte(proposal.ExecutionData), &upgrade); err != nil {
		return fmt.Errorf("failed to parse upgrade data: %w", err)
	}

	executionTime := time.Now().Add(time.Duration(upgrade.TimelockHours) * time.Hour)

	logging.Info().
		Str("program_id", upgrade.ProgramID).
		Str("new_version", upgrade.NewVersion).
		Time("execution_time", executionTime).
		Msg("Scheduling protocol upgrade")

	// Record pending upgrade
	pendingUpgrade := models.PendingUpgrade{
		ProposalID:      proposal.ID,
		ProgramID:       upgrade.ProgramID,
		NewVersion:      upgrade.NewVersion,
		ChangelogCID:    upgrade.ChangelogCID,
		RollbackPlanCID: upgrade.RollbackPlanCID,
		ScheduledAt:     executionTime,
		Status:          "scheduled",
		CreatedAt:       time.Now(),
	}

	if err := db.DB.Create(&pendingUpgrade).Error; err != nil {
		return fmt.Errorf("failed to schedule upgrade: %w", err)
	}

	return nil
}

// CheckAndExecutePassedProposals checks for passed proposals and executes them
func (e *ProposalExecutor) CheckAndExecutePassedProposals() error {
	var proposals []models.Proposal

	// Find proposals that passed but aren't executed yet
	err := db.DB.Where("status = ?", models.ProposalPassed).Find(&proposals).Error
	if err != nil {
		return err
	}

	for _, proposal := range proposals {
		if execErr := e.ExecuteProposal(proposal); execErr != nil {
			if errors.Is(execErr, ErrTreasuryAwaitingCustody) {
				logging.Info().
					Str("proposal_id", proposal.ID.String()).
					Msg("Treasury proposal left in passed — awaiting custody (no hot-wallet spend)")
				continue
			}
			logging.Error(execErr).
				Str("proposal_id", proposal.ID.String()).
				Msg("Failed to execute proposal")
		}
	}

	return nil
}

// CheckAndCloseExpiredProposals closes voting on expired proposals.
// Prefer on-chain finalize when a proposal PDA exists; otherwise close from DB
// votes + quorum. Does not auto-spend treasury.
func (e *ProposalExecutor) CheckAndCloseExpiredProposals() error {
	var proposals []models.Proposal

	now := time.Now()
	err := db.DB.Where("status = ? AND end_time < ?", models.ProposalActive, now).Find(&proposals).Error
	if err != nil {
		return err
	}

	oracle := solanaClient.GetOracleClient()

	for _, proposal := range proposals {
		if oracle != nil && proposal.OnChainPDA != "" {
			pda, pdaErr := sol.PublicKeyFromBase58(proposal.OnChainPDA)
			if pdaErr == nil {
				if _, finErr := oracle.FinalizeProposalOnChain(e.ctx, pda); finErr == nil {
					onChain, fetchErr := oracle.ReadGovernanceProposal(e.ctx, pda)
					if fetchErr == nil && onChain != nil {
						newStatus := models.ProposalRejected
						if onChain.Status == 1 {
							newStatus = models.ProposalPassed
						} else if onChain.Status == 3 {
							newStatus = models.ProposalExecuted
						} else if onChain.Status == 0 {
							// Not closed on-chain yet (slot still open) — skip DB force-close.
							logging.Debug().
								Str("proposal_id", proposal.ID.String()).
								Msg("On-chain voting window still open; waiting for end_slot")
							continue
						}
						db.DB.Model(&proposal).Updates(map[string]interface{}{
							"status":    newStatus,
							"yes_votes": float64(onChain.VoteYes),
							"no_votes":  float64(onChain.VoteNo),
						})
						logging.Info().
							Str("proposal_id", proposal.ID.String()).
							Str("status", string(newStatus)).
							Msg("Proposal closed via on-chain finalize")
						continue
					}
				} else {
					logging.Debug().Err(finErr).
						Str("proposal_id", proposal.ID.String()).
						Msg("On-chain finalize not ready; falling back to DB close if quorum met")
				}
			}
		}

		// DB fallback: wall-clock expiry + quorum (mirrors historical behavior).
		passed := e.checkProposalOutcome(proposal)
		newStatus := models.ProposalRejected
		if passed {
			newStatus = models.ProposalPassed
		}
		db.DB.Model(&proposal).Update("status", newStatus)
		logging.Info().
			Str("proposal_id", proposal.ID.String()).
			Bool("passed", passed).
			Msg("Proposal voting closed (DB fallback)")
	}

	return nil
}

// checkProposalOutcome determines if a proposal passed
func (e *ProposalExecutor) checkProposalOutcome(proposal models.Proposal) bool {
	// Simple majority rule: yes > no
	if proposal.YesVotes <= proposal.NoVotes {
		return false
	}

	// Check quorum (default 10% of possible voting power)
	totalVotes := proposal.YesVotes + proposal.NoVotes
	requiredQuorum := proposal.Quorum
	if requiredQuorum == 0 {
		requiredQuorum = 100 // Default quorum
	}

	return totalVotes >= requiredQuorum
}

// ScheduleProposalWorker runs periodic checks for proposal execution.
// The worker stops cleanly when ctx is cancelled.
func ScheduleProposalWorker(ctx context.Context) {
	executor := NewProposalExecutor()

	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				logging.Info().Msg("Governance proposal worker shutting down")
				return
			case <-ticker.C:
				// Close expired proposals
				if err := executor.CheckAndCloseExpiredProposals(); err != nil {
					logging.Error(err).Msg("Failed to close expired proposals")
				}

				// Execute passed proposals (treasury stays pending_custody)
				if err := executor.CheckAndExecutePassedProposals(); err != nil {
					logging.Error(err).Msg("Failed to execute passed proposals")
				}
			}
		}
	}()
}

// Helper types for governance records
type GovernanceStats struct {
	TotalProposals       int64   `json:"total_proposals"`
	ActiveProposals      int64   `json:"active_proposals"`
	PassedProposals      int64   `json:"passed_proposals"`
	RejectedProposals    int64   `json:"rejected_proposals"`
	TotalVotes           int64   `json:"total_votes"`
	UniqueVoters         int64   `json:"unique_voters"`
	AverageParticipation float64 `json:"average_participation"`
}

// GetGovernanceStats returns governance statistics
func GetGovernanceStats() (*GovernanceStats, error) {
	var stats GovernanceStats

	db.DB.Model(&models.Proposal{}).Count(&stats.TotalProposals)
	db.DB.Model(&models.Proposal{}).Where("status = ?", models.ProposalActive).Count(&stats.ActiveProposals)
	db.DB.Model(&models.Proposal{}).Where("status = ?", models.ProposalPassed).Count(&stats.PassedProposals)
	db.DB.Model(&models.Proposal{}).Where("status = ?", models.ProposalRejected).Count(&stats.RejectedProposals)
	db.DB.Model(&models.Vote{}).Count(&stats.TotalVotes)
	db.DB.Model(&models.Vote{}).Distinct("voter_id").Count(&stats.UniqueVoters)

	return &stats, nil
}
