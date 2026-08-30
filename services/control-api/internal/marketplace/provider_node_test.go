package marketplace

import (
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
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

func TestResolveProviderNodeForSession_UsesLegacyNodeMirror(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "sessions", "nodes", "provider_nodes", "wallets", "users")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("earn_mirror_provider"), "provider")
	pn := models.ProviderNode{
		ID:        uuid.New(),
		UserID:    provider.ID,
		Name:      "earn-mirror",
		Status:    models.NodeOnline,
		IsHealthy: true,
		IPAddress: "10.0.0.41",
		Port:      1080,
	}
	if err := db.DB.Create(&pn).Error; err != nil {
		t.Fatalf("provider node: %v", err)
	}
	mirror := models.Node{
		UserID:         provider.ID,
		ProviderUserID: provider.ID,
		IPAddress:      "10.0.0.41",
		Port:           1080,
		IsHealthy:      true,
		MaxConnections: 10,
	}
	pnID := pn.ID
	mirror.ProviderNodeID = &pnID
	if err := db.DB.Create(&mirror).Error; err != nil {
		t.Fatalf("legacy node: %v", err)
	}

	session := models.Session{NodeID: &mirror.ID}
	got, err := ResolveProviderNodeForSession(session)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if got.ID != pn.ID {
		t.Fatalf("resolved %s want %s", got.ID, pn.ID)
	}
}
