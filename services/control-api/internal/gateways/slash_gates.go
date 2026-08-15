package gateways

import (
	"os"
	"strings"
)

// UnsafeSessionProgramID is programs/session — never the Wave 8 bond vehicle.
const UnsafeSessionProgramID = "8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb"

func slashEnvTruthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// SlashExecuteMode is public honesty for Wave 8 dual-gates.
// live_economic_slash stays false regardless.
func SlashExecuteMode() string {
	if strings.TrimSpace(os.Getenv("PROXYHUB_GATEWAY_BOND_PROGRAM_ID")) == UnsafeSessionProgramID {
		return "rejected_session_program"
	}
	armed := slashEnvTruthy(os.Getenv("PROXYHUB_GATEWAY_SLASH_AUTO")) &&
		os.Getenv("PROXYHUB_GATEWAY_SLASH_CONFIRM") == "1"
	if armed {
		return "gates_armed_undeployed"
	}
	return "off"
}

// BondedGatewayProgramHonesty is code-complete, not deployed.
func BondedGatewayProgramHonesty() string {
	return "localnet_soak"
}
