// Smoke: PROXYHUB_PROVIDER_REGISTRY_GATE=enforce blocks empty / invalid hotkeys
// (session activation uses the same providergate.Check hook).
package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/providergate"
)

func mustBlock(label string, node *models.ProviderNode) {
	err := providergate.Check(context.Background(), node)
	if err == nil {
		fmt.Fprintf(os.Stderr, "%s: expected ErrProviderRegistryInactive\n", label)
		os.Exit(1)
	}
	if !errors.Is(err, providergate.ErrProviderRegistryInactive) {
		fmt.Fprintf(os.Stderr, "%s: want ErrProviderRegistryInactive, got %v\n", label, err)
		os.Exit(1)
	}
	fmt.Printf("OK %s: %v\n", label, err)
}

func main() {
	_ = os.Setenv("PROXYHUB_PROVIDER_REGISTRY_GATE", "enforce")

	mustBlock("empty_hotkey", &models.ProviderNode{Hotkey: ""})
	mustBlock("invalid_hotkey", &models.ProviderNode{Hotkey: "not-a-pubkey"})
	// Valid base58 but almost certainly no ProviderRegistry PDA → read_err / inactive.
	mustBlock("unregistered_hotkey", &models.ProviderNode{
		Hotkey: "11111111111111111111111111111112",
	})

	fmt.Println("OK registry_enforce_smoke (empty + invalid + unregistered)")
}
