package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// W-35: withdrawal status list returns only the caller's rows, newest first.
func TestGetMyWithdrawals_P2_OwnRowsOnlyNewestFirst(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "profiles", "auth.users", "withdrawal_payout_queue")

	user, _ := createWalletTestUser(t)
	other := testutil.CreateTestUser(t, testutil.UniqueEmail("wd-other"), "buyer")

	now := time.Now().UTC()
	seed := []models.WithdrawalPayout{
		{UserID: user.ID, Reference: "wd-old", Destination: "DestA", AmountSOL: 1, Status: models.WithdrawalPayoutCompleted, CreatedAt: now.Add(-2 * time.Hour)},
		{UserID: user.ID, Reference: "wd-new", Destination: "DestA", AmountSOL: 2, Status: models.WithdrawalPayoutRequested, CreatedAt: now.Add(-time.Minute)},
		{UserID: other.ID, Reference: "wd-other", Destination: "DestB", AmountSOL: 3, Status: models.WithdrawalPayoutRequested, CreatedAt: now},
	}
	for i := range seed {
		if err := db.DB.Create(&seed[i]).Error; err != nil {
			t.Fatal(err)
		}
	}

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.GET("/wallet/withdrawals", getMyWithdrawals)

	req := httptest.NewRequest(http.MethodGet, "/wallet/withdrawals", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	var resp struct {
		Withdrawals []models.WithdrawalPayout `json:"withdrawals"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Withdrawals) != 2 {
		t.Fatalf("want only caller's 2 rows, got %d", len(resp.Withdrawals))
	}
	if resp.Withdrawals[0].Reference != "wd-new" || resp.Withdrawals[1].Reference != "wd-old" {
		t.Fatalf("want newest-first [wd-new wd-old], got [%s %s]",
			resp.Withdrawals[0].Reference, resp.Withdrawals[1].Reference)
	}
}
