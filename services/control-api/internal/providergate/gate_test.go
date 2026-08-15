package providergate

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
)

func TestCheckOff(t *testing.T) {
	t.Setenv("PROXYHUB_PROVIDER_REGISTRY_GATE", "off")
	node := &models.ProviderNode{ID: uuid.New()}
	if err := Check(context.Background(), node); err != nil {
		t.Fatalf("off mode must no-op: %v", err)
	}
}

func TestCheckEnforceNoHotkey(t *testing.T) {
	t.Setenv("PROXYHUB_PROVIDER_REGISTRY_GATE", "enforce")
	node := &models.ProviderNode{ID: uuid.New(), Hotkey: ""}
	err := Check(context.Background(), node)
	if !errors.Is(err, ErrProviderRegistryInactive) {
		t.Fatalf("expected ErrProviderRegistryInactive, got %v", err)
	}
}

func TestCheckObserveNoHotkey(t *testing.T) {
	t.Setenv("PROXYHUB_PROVIDER_REGISTRY_GATE", "observe")
	node := &models.ProviderNode{ID: uuid.New(), Hotkey: ""}
	if err := Check(context.Background(), node); err != nil {
		t.Fatalf("observe must not fail: %v", err)
	}
}
