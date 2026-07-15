package governance

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/models"
)

// ValidateExecutionPayload ensures execution_data matches the proposal type before persistence.
func ValidateExecutionPayload(proposalType models.ProposalType, raw json.RawMessage) error {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" || trimmed == "{}" {
		switch proposalType {
		case models.ProposalTypeGeneral:
			return nil
		default:
			return fmt.Errorf("execution_data is required for proposal type %q", proposalType)
		}
	}

	switch proposalType {
	case models.ProposalTypeGeneral:
		return nil
	case models.ProposalTypeTreasury:
		var transfer TreasuryTransfer
		if err := json.Unmarshal(raw, &transfer); err != nil {
			return fmt.Errorf("invalid treasury execution_data: %w", err)
		}
		if strings.TrimSpace(transfer.Recipient) == "" {
			return fmt.Errorf("treasury recipient is required")
		}
		if _, err := base58.Decode(transfer.Recipient); err != nil {
			return fmt.Errorf("treasury recipient must be a valid base58 Solana address")
		}
		if transfer.Amount <= 0 {
			return fmt.Errorf("treasury amount must be greater than zero")
		}
		currency := strings.ToUpper(strings.TrimSpace(transfer.Currency))
		if currency != "SOL" {
			return fmt.Errorf("treasury currency must be SOL")
		}
		if strings.TrimSpace(transfer.Description) == "" {
			return fmt.Errorf("treasury description is required")
		}
		return nil
	case models.ProposalTypeParameter:
		var change ParameterChange
		if err := json.Unmarshal(raw, &change); err != nil {
			return fmt.Errorf("invalid parameter execution_data: %w", err)
		}
		param := strings.TrimSpace(change.Parameter)
		if param == "" {
			return fmt.Errorf("parameter name is required")
		}
		allowed := map[string]bool{
			"platform_fee":           true,
			"min_stake":              true,
			"governance_quorum":      true,
			"gateway_enforce_mode":   true,
		}
		if !allowed[param] {
			return fmt.Errorf("unsupported parameter %q", param)
		}
		if change.NewValue == nil {
			return fmt.Errorf("new_value is required")
		}
		if strings.TrimSpace(change.Reason) == "" {
			return fmt.Errorf("reason is required for parameter changes")
		}
		return nil
	case models.ProposalTypeSlash:
		var slash GatewaySlash
		if err := json.Unmarshal(raw, &slash); err != nil {
			return fmt.Errorf("invalid slash execution_data: %w", err)
		}
		if strings.TrimSpace(slash.GatewayAddress) == "" {
			return fmt.Errorf("gateway_address is required")
		}
		if _, err := base58.Decode(slash.GatewayAddress); err != nil {
			return fmt.Errorf("gateway_address must be a valid base58 Solana address")
		}
		if slash.SlashPercentage > 100 {
			return fmt.Errorf("slash_percentage must be between 0 and 100")
		}
		if strings.TrimSpace(slash.Reason) == "" {
			return fmt.Errorf("slash reason is required")
		}
		return nil
	case models.ProposalTypeUpgrade:
		var upgrade UpgradeProposal
		if err := json.Unmarshal(raw, &upgrade); err != nil {
			return fmt.Errorf("invalid upgrade execution_data: %w", err)
		}
		if strings.TrimSpace(upgrade.ProgramID) == "" {
			return fmt.Errorf("program_id is required")
		}
		if _, err := base58.Decode(upgrade.ProgramID); err != nil {
			return fmt.Errorf("program_id must be a valid base58 Solana address")
		}
		if strings.TrimSpace(upgrade.NewVersion) == "" {
			return fmt.Errorf("new_version is required")
		}
		if upgrade.TimelockHours < 0 {
			return fmt.Errorf("timelock_hours cannot be negative")
		}
		return nil
	default:
		return fmt.Errorf("unknown proposal type %q", proposalType)
	}
}
