package crypto

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestProviderNodeTokenCarriesKindAndProviderRole(t *testing.T) {
	secret := "test-secret-test-secret-test-secret-1234"
	userID := uuid.New()

	tok, err := GenerateProviderNodeToken(userID, secret, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := ValidateToken(tok, secret)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if !claims.IsProviderNode() || claims.Kind != TokenKindProviderNode {
		t.Fatalf("kind = %q, want %q", claims.Kind, TokenKindProviderNode)
	}
	if claims.UserID != userID.String() || claims.Role != "provider" {
		t.Fatalf("claims = user %q role %q, want %s provider", claims.UserID, claims.Role, userID)
	}
	if claims.IsExtensionDevice() {
		t.Fatal("a provider-node token must not look like an extension token")
	}

	web, err := GenerateToken(userID, "provider", "", "", secret, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	webClaims, err := ValidateToken(web, secret)
	if err != nil {
		t.Fatal(err)
	}
	if webClaims.IsProviderNode() {
		t.Fatal("a normal session JWT must not be marked as a provider-node token")
	}
}
