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

// W-06 regression: the settings API must reject 0 / negative limits instead
// of storing values that historically meant "unlimited".
func TestUpdateSpendingLimits_P0_RejectsNonPositive(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "spending_records")

	user, wallet := createWalletTestUser(t)
	wallet.DailyLimit = 10
	wallet.WeeklyLimit = 50
	wallet.MonthlyLimit = 100
	db.DB.Save(&wallet)

	put := func(body map[string]interface{}) *httptest.ResponseRecorder {
		r := setupTestRouter()
		r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
		r.PUT("/wallet/limits", updateSpendingLimits)
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPut, "/wallet/limits", bytes.NewBuffer(raw))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	for _, body := range []map[string]interface{}{
		{"daily": 0},
		{"weekly": 0},
		{"monthly": -5},
	} {
		if w := put(body); w.Code != http.StatusBadRequest {
			t.Fatalf("body %v: expected 400, got %d (%s)", body, w.Code, w.Body.String())
		}
	}

	// Stored limits untouched by rejected requests.
	var got models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&got).Error; err != nil {
		t.Fatalf("reload wallet: %v", err)
	}
	if got.DailyLimit != 10 || got.WeeklyLimit != 50 || got.MonthlyLimit != 100 {
		t.Fatalf("limits must be unchanged after rejected updates: %v/%v/%v", got.DailyLimit, got.WeeklyLimit, got.MonthlyLimit)
	}

	// A valid positive update still works.
	if w := put(map[string]interface{}{"daily": 5}); w.Code != http.StatusOK {
		t.Fatalf("valid update: expected 200, got %d (%s)", w.Code, w.Body.String())
	}
}
