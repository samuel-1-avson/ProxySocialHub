package api

import (
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestMaybeBindProviderHotkey_BindsWhenEmpty(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("bind-hotkey"), "provider")
	node := models.ProviderNode{
		ID:     uuid.New(),
		UserID: user.ID,
		Name:   "bind-test",
		Status: models.NodeOffline,
	}
	if err := db.DB.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	signer := "GXdz7cj6JK4qvQzgrwkBPJUkgcFMW68jQwonMQqAzrkF"
	if !maybeBindProviderHotkey(node.ID, user.ID, signer, true) {
		t.Fatal("expected hotkey bind to succeed")
	}

	var updated models.ProviderNode
	if err := db.DB.First(&updated, "id = ?", node.ID).Error; err != nil {
		t.Fatalf("reload node: %v", err)
	}
	if updated.Hotkey != signer {
		t.Fatalf("hotkey = %q, want %q", updated.Hotkey, signer)
	}
}

func TestMaybeBindProviderHotkey_RejectsWalletMismatch(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("bind-mismatch"), "provider")
	wallet := "11111111111111111111111111111111"
	if err := db.DB.Model(&models.User{}).Where("id = ?", user.ID).Update("wallet_address", wallet).Error; err != nil {
		t.Fatalf("set wallet: %v", err)
	}

	node := models.ProviderNode{
		ID:     uuid.New(),
		UserID: user.ID,
		Name:   "mismatch",
		Status: models.NodeOffline,
	}
	if err := db.DB.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	signer := "GXdz7cj6JK4qvQzgrwkBPJUkgcFMW68jQwonMQqAzrkF"
	if maybeBindProviderHotkey(node.ID, user.ID, signer, true) {
		t.Fatal("expected bind to fail when signer != profile wallet")
	}

	var updated models.ProviderNode
	db.DB.First(&updated, "id = ?", node.ID)
	if updated.Hotkey != "" {
		t.Fatalf("hotkey should stay empty, got %q", updated.Hotkey)
	}
}
