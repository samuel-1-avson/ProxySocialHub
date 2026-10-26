package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// W-34 regression: P2P previously ignored security flags entirely -
// only withdrawals checked them. A frozen sender must get 403 and no
// ledger movement.
func TestTransferP2P_FrozenSenderBlocked_P2(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "spending_records", "user_flags")

	sender, senderWallet := createWalletTestUser(t)
	recipient := testutil.CreateTestUser(t, testutil.UniqueEmail("freeze-recipient"), "buyer")

	senderWallet.BalanceSOL = 50.0
	senderWallet.LimitsEnabled = false
	db.DB.Save(&senderWallet)

	if err := db.DB.Create(&models.UserFlag{
		UserID: sender.ID, FlagType: "security_review", Reason: "test freeze",
	}).Error; err != nil {
		t.Fatal(err)
	}

	r := setupTestRouter()
	r.Use(authMiddlewareMock(sender.ID.String(), "buyer"))
	r.POST("/wallet/transfer", transferP2P)

	body, _ := json.Marshal(map[string]interface{}{"recipient": recipient.Email, "amount": 1.0})
	req := httptest.NewRequest(http.MethodPost, "/wallet/transfer", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("frozen sender want 403, got %d body %s", w.Code, w.Body.String())
	}
	var ledgerCount int64
	db.DB.Model(&models.WalletLedgerEntry{}).Where("wallet_id = ?", senderWallet.ID).Count(&ledgerCount)
	if ledgerCount != 0 {
		t.Fatalf("frozen transfer must not write ledger entries, got %d", ledgerCount)
	}
}
