package solana

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/proxyhubb/control-api/internal/redis"
)

// ProgramUpgradeRequiredError indicates that the deployed Solana program
// does not support a required instruction/feature yet.
type ProgramUpgradeRequiredError struct {
	Feature     string
	Instruction string
	Cause       error
}

func (e *ProgramUpgradeRequiredError) Error() string {
	msg := fmt.Sprintf("program upgrade required for feature=%s instruction=%s", e.Feature, e.Instruction)
	if e.Cause != nil {
		msg += ": " + e.Cause.Error()
	}
	return msg
}

func (e *ProgramUpgradeRequiredError) Unwrap() error { return e.Cause }

// NewProgramUpgradeRequiredError builds a typed upgrade-required error that
// callers can map to a clear API response.
func NewProgramUpgradeRequiredError(feature, instruction string, cause error) error {
	return &ProgramUpgradeRequiredError{
		Feature:     feature,
		Instruction: instruction,
		Cause:       cause,
	}
}

// IsProgramUpgradeRequired returns true when err wraps ProgramUpgradeRequiredError.
func IsProgramUpgradeRequired(err error) bool {
	var target *ProgramUpgradeRequiredError
	return errors.As(err, &target)
}

// IsInstructionUnsupportedError heuristically classifies RPC/program errors that
// indicate an instruction discriminator is not implemented in the deployed program.
func IsInstructionUnsupportedError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	markers := []string{
		"instructionfallbacknotfound",
		"fallback functions are not supported",
		"unknown instruction",
		"custom program error: 0x65",
		"discriminator",
	}
	for _, m := range markers {
		if strings.Contains(msg, m) {
			return true
		}
	}
	return false
}

// StakingCapabilityReport summarizes whether the deployed program can handle
// staking_v2 instruction paths used by control-api.
type StakingCapabilityReport struct {
	Feature              string   `json:"feature"`
	ProgramID            string   `json:"program_id,omitempty"`
	OracleConfigured     bool     `json:"oracle_configured"`
	RequiredInstructions []string `json:"required_instructions"`
	IDLCached            bool     `json:"idl_cached"`
	IDLSource            string   `json:"idl_source,omitempty"`
	Supported            bool     `json:"supported"`
	MissingInstructions  []string `json:"missing_instructions,omitempty"`
	Ready                bool     `json:"ready"`
	Status               string   `json:"status"`
	Message              string   `json:"message"`
}

// GovernanceExecutionCapabilityReport summarizes whether the deployed program
// can support chain-authoritative governance execution paths.
type GovernanceExecutionCapabilityReport struct {
	Feature              string   `json:"feature"`
	ProgramID            string   `json:"program_id,omitempty"`
	OracleConfigured     bool     `json:"oracle_configured"`
	RequiredInstructions []string `json:"required_instructions"`
	IDLCached            bool     `json:"idl_cached"`
	IDLSource            string   `json:"idl_source,omitempty"`
	Supported            bool     `json:"supported"`
	MissingInstructions  []string `json:"missing_instructions,omitempty"`
	Ready                bool     `json:"ready"`
	Status               string   `json:"status"`
	Message              string   `json:"message"`
}

// GetStakingCapabilityReport builds an operator-facing readiness report for
// staking_v2 support on the currently configured Solana program deployment.
func GetStakingCapabilityReport(ctx context.Context) StakingCapabilityReport {
	required := []string{"stake_provider", "unstake_provider"}
	report := StakingCapabilityReport{
		Feature:              "staking_v2",
		RequiredInstructions: required,
		Status:               "unknown",
		Message:              "staking capability has not been evaluated",
	}

	oracle := GetOracleClient()
	if oracle == nil {
		report.OracleConfigured = false
		report.Ready = false
		report.Status = "oracle_unavailable"
		report.Message = "oracle client is not configured"
		return report
	}

	report.OracleConfigured = true
	report.ProgramID = oracle.programID.String()

	supported, determined, missing, source := supportsInstructionsFromSource(ctx, report.ProgramID, required...)
	report.IDLCached = source == "redis_cache"
	report.IDLSource = source
	report.Supported = supported
	report.MissingInstructions = missing

	if !determined {
		report.Ready = false
		report.Status = "unknown"
		report.Message = "instruction source is unavailable; readiness cannot be pre-verified"
		return report
	}

	if !supported {
		report.Ready = false
		report.Status = "upgrade_required"
		report.Message = fmt.Sprintf("deployed program is missing required instructions: %s", strings.Join(missing, ","))
		return report
	}

	report.Ready = true
	report.Status = "ready"
	report.Message = "deployed program supports staking_v2 instructions"
	return report
}

// GetGovernanceExecutionCapabilityReport builds an operator-facing readiness
// report for chain-authoritative governance execution support.
func GetGovernanceExecutionCapabilityReport(ctx context.Context) GovernanceExecutionCapabilityReport {
	required := []string{"create_proposal", "cast_governance_vote", "finalize_proposal"}
	report := GovernanceExecutionCapabilityReport{
		Feature:              "governance_execution",
		RequiredInstructions: required,
		Status:               "unknown",
		Message:              "governance execution capability has not been evaluated",
	}

	oracle := GetOracleClient()
	if oracle == nil {
		report.OracleConfigured = false
		report.Ready = false
		report.Status = "oracle_unavailable"
		report.Message = "oracle client is not configured"
		return report
	}

	report.OracleConfigured = true
	report.ProgramID = oracle.programID.String()

	supported, determined, missing, source := supportsInstructionsFromSource(ctx, report.ProgramID, required...)
	report.IDLCached = source == "redis_cache"
	report.IDLSource = source
	report.Supported = supported
	report.MissingInstructions = missing

	if !determined {
		report.Ready = false
		report.Status = "unknown"
		report.Message = "instruction source is unavailable; readiness cannot be pre-verified"
		return report
	}

	if !supported {
		report.Ready = false
		report.Status = "upgrade_required"
		report.Message = fmt.Sprintf("deployed program is missing required instructions: %s", strings.Join(missing, ","))
		return report
	}

	onChain := GetProgramOnChainReport(ctx)
	if !onChain.Ready {
		report.Ready = false
		report.Status = onChain.Status
		report.Message = onChain.Message
		return report
	}

	report.Ready = true
	report.Status = "ready"
	report.Message = "deployed program supports governance execution instructions"
	return report
}

// SupportsInstructionsFromCachedIDL checks Redis-cached Anchor IDL for instruction presence.
// Returns:
// - supported=true, determined=true when all instructions are present
// - supported=false, determined=true when at least one is missing
// - supported=false, determined=false when no source is available (unknown)
func SupportsInstructionsFromCachedIDL(ctx context.Context, programID string, instructionNames ...string) (supported bool, determined bool, missing []string) {
	supported, determined, missing, _ = supportsInstructionsFromSource(ctx, programID, instructionNames...)
	return supported, determined, missing
}

func supportsInstructionsFromSource(ctx context.Context, programID string, instructionNames ...string) (supported bool, determined bool, missing []string, source string) {
	cacheClient := redis.Client
	if cacheClient == nil {
		return supportsInstructionsFromCompiled(instructionNames...), true, supportsMissingFromCompiled(instructionNames...), "compiled_allowlist"
	}

	raw, err := cacheClient.Get(ctx, idlCacheKey(programID)).Bytes()
	if err != nil || len(raw) == 0 {
		return supportsInstructionsFromCompiled(instructionNames...), true, supportsMissingFromCompiled(instructionNames...), "compiled_allowlist"
	}

	var payload struct {
		Instructions []struct {
			Name string `json:"name"`
		} `json:"instructions"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return supportsInstructionsFromCompiled(instructionNames...), true, supportsMissingFromCompiled(instructionNames...), "compiled_allowlist"
	}

	available := make(map[string]struct{}, len(payload.Instructions))
	for _, inst := range payload.Instructions {
		available[strings.ToLower(strings.TrimSpace(inst.Name))] = struct{}{}
	}

	for _, name := range instructionNames {
		n := strings.ToLower(strings.TrimSpace(name))
		if n == "" {
			continue
		}
		if _, ok := available[n]; !ok {
			missing = append(missing, n)
		}
	}

	if len(missing) > 0 {
		return false, true, missing, "redis_cache"
	}
	return true, true, nil, "redis_cache"
}

func supportsInstructionsFromCompiled(instructionNames ...string) bool {
	missing := supportsMissingFromCompiled(instructionNames...)
	return len(missing) == 0
}

func supportsMissingFromCompiled(instructionNames ...string) []string {
	compiled := map[string]struct{}{
		"settle_escrow":             {},
		"emergency_refund":          {},
		"slash_stake":               {},
		"stake_provider":            {},
		"unstake_provider":          {},
		"submit_usage_proof":        {},
		"register_provider":         {},
		"provider_heartbeat":        {},
		"deregister_provider":       {},
		"update_program_config":     {},
		"create_proposal":           {},
		"cast_governance_vote":      {},
		"finalize_proposal":         {},
		"open_channel":              {},
		"close_channel":             {},
		"open_dispute_onchain":      {},
		"submit_review_attestation": {},
		"write_kyc_attestation":     {},
		"submit_zk_batch":           {},
		"write_admin_attestation":   {},
		"lock_session_commitment":   {},
		"initialize_session_escrow": {},
		"settle_session_escrow":     {},
	}

	missing := make([]string, 0)
	for _, name := range instructionNames {
		n := strings.ToLower(strings.TrimSpace(name))
		if n == "" {
			continue
		}
		if _, ok := compiled[n]; !ok {
			missing = append(missing, n)
		}
	}
	return missing
}
