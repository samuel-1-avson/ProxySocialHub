package api

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/custody"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// managedWalletUser creates a user whose payout wallet is a server-held wallet,
// like a Google sign-up.
func managedWalletUser(t *testing.T) (*models.User, string) {
	t.Helper()
	t.Setenv("EMBEDDED_WALLET_KEK", strings.Repeat("ef", 32))
	t.Setenv("APP_ENV", "development")
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("managed"), "buyer")
	kek, err := custody.DefaultKEK()
	if err != nil {
		t.Fatal(err)
	}
	row, err := custody.CreateSolanaWallet(db.DB, kek, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.DB.Model(&models.User{}).Where("id = ?", user.ID).Update("wallet_address", row.Address).Error; err != nil {
		t.Fatal(err)
	}
	user.WalletAddress = &row.Address
	user.Status = models.UserStatusActive
	return user, row.Address
}

func TestProviderAutoApproval_ManagedWalletSkipsBalanceCheck(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "embedded_wallets", "wallets", "users")
	user, _ := managedWalletUser(t)

	got := defaultProviderAutoApproval(context.Background(), user)
	if got.Status != "approved" || got.ReasonCode != "managed_wallet" || !got.AutoApproved {
		t.Fatalf("managed wallet at 0 SOL: got %+v", got)
	}
}

func TestProviderAutoApproval_ExternalWalletStillChecked(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "embedded_wallets", "wallets", "users")
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("phantom"), "buyer")
	addr := "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
	user.WalletAddress = &addr
	user.Status = models.UserStatusActive

	got := defaultProviderAutoApproval(context.Background(), user)
	if got.Status == "approved" {
		t.Fatalf("Phantom user without a balance check must not be auto-approved: %+v", got)
	}
}

func TestNodePayoutAddressPrefersManagedWallet(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "embedded_wallets", "wallets", "users")
	user, managed := managedWalletUser(t)

	if got := nodePayoutAddress(user.ID, "DeviceHotkey1111111111111111111111111111111"); got != managed {
		t.Fatalf("managed owner: got %s, want %s", got, managed)
	}
	if got := nodePayoutAddress(uuid.New(), "DeviceHotkey1111111111111111111111111111111"); got != "DeviceHotkey1111111111111111111111111111111" {
		t.Fatalf("external owner must keep the hotkey, got %s", got)
	}
}
