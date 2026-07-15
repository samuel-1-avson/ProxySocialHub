// DECOMMISSIONED: Ethereum Relayer
//
// This service has been removed as part of the ProxyHubb Layer 2 architecture
// transition (2026-04-01).
//
// Reason: ProxyHubb is committing exclusively to Solana for all on-chain
// operations. Running a parallel Ethereum relayer created:
//   - Two sources of financial truth (Solana escrow + Ethereum marketplace contract)
//   - ETH gas costs incompatible with bandwidth micropayment economics
//   - Operational complexity with zero user-facing benefit
//
// All provider payouts now flow exclusively through the Solana escrow program
// (services/solana-programs/proxyhub/) via the control-api oracle client
// (services/control-api/internal/solana/).
//
// The Ethereum ProxyMarketplace contract (eth/bindings/ProxyMarketplace.abi)
// and its Go bindings are preserved here for historical reference only.
// They are NOT deployed or used.
//
// Layer 2 roadmap: PHB token (SPL) → state channels → ZK rollup on Solana.
// See docs/PROJECT_STATE.md and docs/openapi.yaml for control-plane scope.

package main

import (
	"log"
	"os"
)

func main() {
	log.Println("ERROR: The Ethereum relayer has been decommissioned.")
	log.Println("All payouts now route through the Solana oracle (control-api).")
	log.Println("Remove this service from your deployment. It does nothing.")
	os.Exit(1)
}
