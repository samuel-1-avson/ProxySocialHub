package solana

import (
	"strings"

	"github.com/proxyhubb/control-api/internal/decentralization"
)

// DepositDestinationKind classifies where a deposit landed.
type DepositDestinationKind string

const (
	DepositDestTreasury DepositDestinationKind = "treasury"
	DepositDestVault    DepositDestinationKind = "vault"
)

// ResolveDepositDestination returns the destination kind for a recipient pubkey,
// or empty if the recipient is not an allowed credit target under current flags.
func ResolveDepositDestination(recipient string) DepositDestinationKind {
	recipient = strings.TrimSpace(recipient)
	if recipient == "" {
		return ""
	}

	vault := GetDepositVaultAddress()
	if vault != "" && recipient == vault && decentralization.DepositVaultCreditEnabled() {
		return DepositDestVault
	}

	treasury := strings.TrimSpace(GetTreasuryAddress())
	if treasury != "" && recipient == treasury && decentralization.DepositLegacyTreasuryCreditEnabled() {
		return DepositDestTreasury
	}

	return ""
}

// AllowedDepositWatchAddresses returns all addresses the watcher should monitor
// for native deposits (legacy treasury and/or vault when credit is enabled).
func AllowedDepositWatchAddresses() []string {
	out := make([]string, 0, 2)
	seen := map[string]struct{}{}
	add := func(addr string) {
		addr = strings.TrimSpace(addr)
		if addr == "" {
			return
		}
		if _, ok := seen[addr]; ok {
			return
		}
		seen[addr] = struct{}{}
		out = append(out, addr)
	}

	if decentralization.DepositLegacyTreasuryCreditEnabled() {
		add(GetTreasuryAddress())
	}
	if decentralization.DepositVaultCreditEnabled() {
		add(GetDepositVaultAddress())
	}
	// Always watch configured addresses even if credit is off, so ops can see
	// inbound SOL — credit gate remains in ResolveDepositDestination / handlers.
	add(GetTreasuryAddress())
	add(GetDepositVaultAddress())
	return out
}

// JournalKindForDeposit maps destination to ledger JournalKind.
func JournalKindForDeposit(kind DepositDestinationKind) string {
	if kind == DepositDestVault {
		return "deposit_vault"
	}
	return ""
}
