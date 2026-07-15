package governance

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/treasury"
)

// ImpactLine is a single row in the impact preview panel.
type ImpactLine struct {
	Label string `json:"label"`
	Value string `json:"value"`
	Hint  string `json:"hint,omitempty"`
}

// ImpactPreview is returned to voters before casting a vote.
type ImpactPreview struct {
	ProposalType   string       `json:"proposal_type"`
	Summary        string       `json:"summary"`
	RiskLevel      string       `json:"risk_level"` // low | medium | high
	Lines          []ImpactLine `json:"lines"`
	Warnings       []string     `json:"warnings,omitempty"`
	AffectedCounts struct {
		ActiveListings int64 `json:"active_listings"`
	} `json:"affected_counts"`
}

func protocolParamValue(name string, fallback string) string {
	if db.DB == nil {
		return fallback
	}
	var param models.ProtocolParameter
	if err := db.DB.First(&param, "name = ?", name).Error; err == nil && strings.TrimSpace(param.Value) != "" {
		return param.Value
	}
	return fallback
}

func countActiveListings() int64 {
	if db.DB == nil {
		return 0
	}
	var n int64
	db.DB.Model(&models.ProxyListing{}).
		Where("status = ? AND deleted_at IS NULL", models.ListingStatusActive).
		Count(&n)
	return n
}

func formatInterfaceValue(v interface{}) string {
	if v == nil {
		return "—"
	}
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case json.Number:
		return x.String()
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}

func riskForTreasury(amountSOL float64, balanceSOL float64) string {
	if amountSOL >= 100 {
		return "high"
	}
	if balanceSOL > 0 && amountSOL/balanceSOL > 0.25 {
		return "high"
	}
	if amountSOL >= 10 {
		return "medium"
	}
	return "low"
}

// BuildImpactPreview computes human-readable impact for a proposal type + execution payload.
func BuildImpactPreview(ctx context.Context, proposalType models.ProposalType, raw json.RawMessage) (*ImpactPreview, error) {
	preview := &ImpactPreview{
		ProposalType: string(proposalType),
		RiskLevel:    "low",
		Lines:        []ImpactLine{},
	}
	preview.AffectedCounts.ActiveListings = countActiveListings()

	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" || trimmed == "{}" {
		switch proposalType {
		case models.ProposalTypeGeneral:
			preview.Summary = "Advisory signal only — no automatic on-chain execution."
			preview.Lines = append(preview.Lines,
				ImpactLine{Label: "Execution", Value: "None"},
				ImpactLine{Label: "Active listings", Value: strconv.FormatInt(preview.AffectedCounts.ActiveListings, 10), Hint: "Marketplace supply at vote time"},
			)
			return preview, nil
		default:
			return nil, fmt.Errorf("execution_data is required for proposal type %q", proposalType)
		}
	}

	switch proposalType {
	case models.ProposalTypeGeneral:
		preview.Summary = "Advisory signal only — no automatic on-chain execution."
		preview.Lines = append(preview.Lines, ImpactLine{Label: "Execution", Value: "None"})
		return preview, nil

	case models.ProposalTypeTreasury:
		var transfer TreasuryTransfer
		if err := json.Unmarshal(raw, &transfer); err != nil {
			return nil, err
		}
		balanceSOL := 0.0
		tm := treasury.NewTreasuryManager()
		if stats, err := tm.GetTreasuryStats(ctx); err == nil && stats != nil {
			balanceSOL = stats.CombinedBalanceSOL
			preview.Lines = append(preview.Lines,
				ImpactLine{Label: "Treasury balance (now)", Value: fmt.Sprintf("%.4f SOL", balanceSOL)},
				ImpactLine{Label: "Treasury status", Value: stats.Status},
			)
		}
		remaining := balanceSOL - transfer.Amount
		if remaining < 0 {
			remaining = 0
		}
		preview.RiskLevel = riskForTreasury(transfer.Amount, balanceSOL)
		preview.Summary = fmt.Sprintf("Treasury would send %.4f SOL to %s",
			transfer.Amount, shortAddr(transfer.Recipient))
		preview.Lines = append(preview.Lines,
			ImpactLine{Label: "Transfer amount", Value: fmt.Sprintf("%.4f SOL", transfer.Amount)},
			ImpactLine{Label: "Recipient", Value: transfer.Recipient},
			ImpactLine{Label: "Balance after (est.)", Value: fmt.Sprintf("%.4f SOL", remaining)},
			ImpactLine{Label: "Purpose", Value: transfer.Description},
			ImpactLine{Label: "Active listings", Value: strconv.FormatInt(preview.AffectedCounts.ActiveListings, 10)},
		)
		if transfer.Amount > balanceSOL && balanceSOL > 0 {
			preview.Warnings = append(preview.Warnings, "Transfer exceeds current combined treasury balance — execution may fail.")
		}
		if transfer.Amount >= 50 {
			preview.Warnings = append(preview.Warnings, "Large outbound transfer — confirm recipient and multisig policy.")
		}
		return preview, nil

	case models.ProposalTypeParameter:
		var change ParameterChange
		if err := json.Unmarshal(raw, &change); err != nil {
			return nil, err
		}
		param := strings.TrimSpace(change.Parameter)
		oldStr := formatInterfaceValue(change.OldValue)
		newStr := formatInterfaceValue(change.NewValue)
		dbOld := protocolParamValue(param, "")
		if dbOld != "" {
			oldStr = dbOld + " (on-chain record)"
		}
		preview.Summary = fmt.Sprintf("Parameter %q would change from %s to %s", param, formatInterfaceValue(change.OldValue), newStr)
		preview.Lines = append(preview.Lines,
			ImpactLine{Label: "Parameter", Value: param},
			ImpactLine{Label: "Submitted old value", Value: oldStr},
			ImpactLine{Label: "Proposed new value", Value: newStr},
			ImpactLine{Label: "Active listings", Value: strconv.FormatInt(preview.AffectedCounts.ActiveListings, 10)},
		)
		switch param {
		case "platform_fee":
			preview.RiskLevel = "medium"
			preview.Lines = append(preview.Lines,
				ImpactLine{Label: "Buyer impact", Value: "Fees on new escrows follow the updated platform fee", Hint: "Does not retroactively change open orders"},
			)
		case "gateway_enforce_mode":
			preview.RiskLevel = "high"
			preview.Warnings = append(preview.Warnings, "Gateway enforcement changes can block or allow provider traffic network-wide.")
		case "governance_quorum":
			preview.RiskLevel = "medium"
			preview.Warnings = append(preview.Warnings, "Quorum changes affect whether future proposals can pass.")
		case "min_stake":
			preview.RiskLevel = "medium"
			preview.Lines = append(preview.Lines,
				ImpactLine{Label: "Provider impact", Value: "Providers may need to adjust stake to list or remain active"},
			)
		}
		if strings.TrimSpace(change.Reason) != "" {
			preview.Lines = append(preview.Lines, ImpactLine{Label: "Rationale", Value: change.Reason})
		}
		return preview, nil

	case models.ProposalTypeSlash:
		var slash GatewaySlash
		if err := json.Unmarshal(raw, &slash); err != nil {
			return nil, err
		}
		preview.RiskLevel = "high"
		preview.Summary = fmt.Sprintf("Gateway %s would be slashed by %d%%", shortAddr(slash.GatewayAddress), slash.SlashPercentage)
		preview.Lines = append(preview.Lines,
			ImpactLine{Label: "Gateway", Value: slash.GatewayAddress},
			ImpactLine{Label: "Slash %", Value: strconv.Itoa(int(slash.SlashPercentage))},
			ImpactLine{Label: "Reason", Value: slash.Reason},
		)
		preview.Warnings = append(preview.Warnings, "Slashing is irreversible once executed on-chain.")
		return preview, nil

	case models.ProposalTypeUpgrade:
		var upgrade UpgradeProposal
		if err := json.Unmarshal(raw, &upgrade); err != nil {
			return nil, err
		}
		preview.RiskLevel = "high"
		preview.Summary = "Program upgrade — affects all escrow and governance instructions."
		preview.Lines = append(preview.Lines,
			ImpactLine{Label: "Program ID", Value: upgrade.ProgramID},
			ImpactLine{Label: "New version", Value: upgrade.NewVersion},
			ImpactLine{Label: "Timelock (hours)", Value: strconv.Itoa(upgrade.TimelockHours)},
		)
		preview.Warnings = append(preview.Warnings, "Upgrade proposals require audited binaries and devnet/mainnet parity checks.")
		return preview, nil

	default:
		preview.Summary = "Unknown proposal type — review execution payload manually."
		preview.RiskLevel = "medium"
		return preview, nil
	}
}

func shortAddr(addr string) string {
	if len(addr) <= 8 {
		return addr
	}
	return addr[:4] + "…" + addr[len(addr)-4:]
}

// BuildImpactPreviewFromProposal loads a proposal and builds its impact preview.
func BuildImpactPreviewFromProposal(ctx context.Context, proposal models.Proposal) (*ImpactPreview, error) {
	raw := json.RawMessage(proposal.ExecutionData)
	if strings.TrimSpace(proposal.ExecutionData) == "" {
		raw = json.RawMessage("{}")
	}
	return BuildImpactPreview(ctx, proposal.Type, raw)
}
