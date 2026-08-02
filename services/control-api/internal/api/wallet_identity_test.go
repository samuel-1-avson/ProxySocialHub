package api

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestEnsurePrimaryLinkedSolana_CreatesAndIdempotent(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "linked_wallets", "wallets", "users")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("link_id"), "buyer")
	addr := "WalletIdentityTest1111111111111111111111111"

	sig := "sig"
	msg := "msg"
	if err := ensurePrimaryLinkedSolana(db.DB, user.ID, addr, &sig, &msg); err != nil {
		t.Fatalf("first ensure: %v", err)
	}

	var rows []models.LinkedWallet
	if err := db.DB.Where("user_id = ? AND chain = ?", user.ID, models.ChainSolana).Find(&rows).Error; err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows=%d want 1", len(rows))
	}
	if !rows[0].IsPrimary || !rows[0].Verified || rows[0].Address != addr {
		t.Fatalf("row=%+v", rows[0])
	}

	if err := ensurePrimaryLinkedSolana(db.DB, user.ID, addr, nil, nil); err != nil {
		t.Fatalf("second ensure: %v", err)
	}
	var count int64
	db.DB.Model(&models.LinkedWallet{}).Where("user_id = ? AND chain = ?", user.ID, models.ChainSolana).Count(&count)
	if count != 1 {
		t.Fatalf("count=%d want 1 after idempotent ensure", count)
	}
}
