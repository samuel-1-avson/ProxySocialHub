package solana

import (
	"context"
	"fmt"
	"strings"

	sol "github.com/gagliardetto/solana-go"
)

// bpfUpgradeableLoader is the owner of upgradeable BPF program accounts.
const bpfUpgradeableLoader = "BPFLoaderUpgradeab1e11111111111111111111111"

// ProgramOnChainReport describes whether the configured program ID is deployed and executable.
type ProgramOnChainReport struct {
	ProgramID  string `json:"program_id"`
	Found      bool   `json:"found"`
	Executable bool   `json:"executable"`
	Owner      string `json:"owner,omitempty"`
	Ready      bool   `json:"ready"`
	Status     string `json:"status"`
	Message    string `json:"message"`
}

// GetProgramOnChainReport checks RPC for a BPF program at the configured program ID.
func GetProgramOnChainReport(ctx context.Context) ProgramOnChainReport {
	programID := strings.TrimSpace(effectiveProgramID())
	report := ProgramOnChainReport{
		ProgramID: programID,
		Status:    "unknown",
		Message:   "program deployment has not been checked",
	}
	if programID == "" {
		report.Status = "invalid_program_id"
		report.Message = "SOLANA_PROGRAM_ID is empty"
		return report
	}

	oracle := GetOracleClient()
	if oracle == nil {
		report.Status = "oracle_unavailable"
		report.Message = "oracle client is not configured"
		return report
	}

	pk, err := sol.PublicKeyFromBase58(programID)
	if err != nil {
		report.Status = "invalid_program_id"
		report.Message = fmt.Sprintf("invalid program id: %v", err)
		return report
	}

	client := oracle.rpc()
	if client == nil {
		report.Status = "rpc_unavailable"
		report.Message = "solana RPC client is not configured"
		return report
	}

	info, err := client.GetAccountInfo(ctx, pk)
	if err != nil {
		report.Status = "rpc_error"
		report.Message = fmt.Sprintf("getAccountInfo failed: %v", err)
		return report
	}
	if info == nil || info.Value == nil {
		report.Status = "not_deployed"
		report.Message = "no account found at program id"
		return report
	}

	report.Found = true
	report.Executable = info.Value.Executable
	report.Owner = info.Value.Owner.String()

	if report.Executable && report.Owner == bpfUpgradeableLoader {
		report.Ready = true
		report.Status = "deployed"
		report.Message = "program is deployed and executable on the configured cluster"
		return report
	}

	if !report.Executable {
		report.Status = "not_executable"
		report.Message = "account exists but is not an executable BPF program (check SOLANA_PROGRAM_ID and cluster)"
		return report
	}

	report.Status = "unexpected_owner"
	report.Message = fmt.Sprintf("executable account owner is %s, expected %s", report.Owner, bpfUpgradeableLoader)
	return report
}
