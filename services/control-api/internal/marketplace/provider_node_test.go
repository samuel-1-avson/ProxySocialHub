package marketplace

import (
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
)

func TestGatewayRoutingNodeID_prefersGatewayNodeID(t *testing.T) {
	userID := uuid.New()
	node := &models.ProviderNode{
		UserID:        userID,
		GatewayNodeID: "node_custom",
	}
	if got := GatewayRoutingNodeID(node); got != "node_custom" {
		t.Fatalf("expected node_custom, got %q", got)
	}
}

func TestGatewayRoutingNodeID_fallsBackToUserScopedID(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	node := &models.ProviderNode{UserID: userID}
	want := "node_11111111-1111-1111-1111-111111111111"
	if got := GatewayRoutingNodeID(node); got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestHashCredentialPassword_isDeterministic(t *testing.T) {
	a := HashCredentialPassword("secret-pass")
	b := HashCredentialPassword("secret-pass")
	if a != b || a == "" {
		t.Fatalf("expected stable non-empty hash, got %q and %q", a, b)
	}
	if HashCredentialPassword("other") == a {
		t.Fatal("expected different passwords to produce different hashes")
	}
}
