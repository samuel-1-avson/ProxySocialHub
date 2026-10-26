package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// W-21: GET /wallet is side-effect-free; provisioning is explicit.
func TestGetWallet_P1_NoWriteOnReadThenInit(t *testing.T) {
	testutil.SetupTestDB(t)
	cleanupWithdrawP0(t)
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("p1-init"), "buyer")
	// Remove the testutil-created wallet to simulate an unprovisioned user.
	if err := db.DB.Where("user_id = ?", user.ID).Delete(&models.Wallet{}).Error; err != nil {
		t.Fatal(err)
	}

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.GET("/wallet", getWallet)
	r.POST("/wallet/init", initWallet)

	req := httptest.NewRequest(http.MethodGet, "/wallet", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("GET unprovisioned wallet: want 404, got %d %s", w.Code, w.Body.String())
	}
	var rows int64
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", user.ID).Count(&rows)
	if rows != 0 {
		t.Fatalf("GET must not create a wallet row, found %d", rows)
	}

	req = httptest.NewRequest(http.MethodPost, "/wallet/init", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("POST init: want 201, got %d %s", w.Code, w.Body.String())
	}
	// Idempotent second init.
	req = httptest.NewRequest(http.MethodPost, "/wallet/init", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("second init: want 200, got %d %s", w.Code, w.Body.String())
	}
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", user.ID).Count(&rows)
	if rows != 1 {
		t.Fatalf("want exactly 1 wallet, got %d", rows)
	}

	req = httptest.NewRequest(http.MethodGet, "/wallet", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET after init: want 200, got %d %s", w.Code, w.Body.String())
	}
}

// W-21: keyset pagination walks the full history without truncation.
func TestWalletTransactions_P1_KeysetPagination(t *testing.T) {
	testutil.SetupTestDB(t)
	cleanupWithdrawP0(t)
	user, wallet := createWalletTestUser(t)

	base := time.Now().Add(-time.Hour).UTC()
	for i := 0; i < 5; i++ {
		entry := models.WalletLedgerEntry{
			WalletID:   wallet.ID,
			Type:       "deposit",
			Amount:     0.1,
			ReferenceID: uuid.NewString(),
			CreatedAt:  base.Add(time.Duration(i) * time.Minute),
		}
		if err := db.DB.Create(&entry).Error; err != nil {
			t.Fatal(err)
		}
	}

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.GET("/wallet/transactions", listMyWalletTransactions)
	get := func(cursor string) (int, []TransactionDTO, string) {
		req := httptest.NewRequest(http.MethodGet, "/wallet/transactions?limit=2&cursor="+cursor, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var body struct {
			Transactions []TransactionDTO `json:"transactions"`
			NextCursor   string           `json:"next_cursor"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v body %s", err, w.Body.String())
		}
		return w.Code, body.Transactions, body.NextCursor
	}

	seen := map[string]bool{}
	cursor := ""
	pages := 0
	for {
		code, txs, next := get(cursor)
		if code != http.StatusOK {
			t.Fatalf("page: %d", code)
		}
		for _, tx := range txs {
			if seen[tx.ID] {
				t.Fatalf("duplicate across pages: %s", tx.ID)
			}
			seen[tx.ID] = true
			if tx.AmountLamports != 100_000_000 {
				t.Fatalf("amount_lamports = %d, want 100000000", tx.AmountLamports)
			}
		}
		pages++
		if next == "" {
			break
		}
		cursor = next
		if pages > 6 {
			t.Fatal("pagination did not terminate")
		}
	}
	if len(seen) != 5 {
		t.Fatalf("want 5 unique transactions, got %d", len(seen))
	}
}

// W-20: P2P transfer accepts exact lamports without the float field.
func TestTransferP2P_P1_AmountLamportsOnly(t *testing.T) {
	testutil.SetupTestDB(t)
	cleanupWithdrawP0(t)

	sender, senderWallet := createWalletTestUser(t)
	recipient := testutil.CreateTestUser(t, testutil.UniqueEmail("p1-xfer"), "buyer")
	var recipientWallet models.Wallet
	if err := db.DB.Where("user_id = ?", recipient.ID).FirstOrCreate(&recipientWallet, models.Wallet{UserID: recipient.ID}).Error; err != nil {
		t.Fatal(err)
	}
	senderWallet.BalanceSOL = 5
	senderWallet.BalanceLamports = 5_000_000_000
	senderWallet.LimitsEnabled = false
	db.DB.Save(&senderWallet)
	recipientWallet.BalanceSOL = 0
	recipientWallet.BalanceLamports = 0
	db.DB.Save(&recipientWallet)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(sender.ID.String(), "buyer"))
	r.POST("/wallet/transfer", transferP2P)
	body, _ := json.Marshal(map[string]interface{}{
		"recipient": recipient.Email, "amount_lamports": 1_500_000_001,
	})
	req := httptest.NewRequest(http.MethodPost, "/wallet/transfer", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("lamports transfer: %d %s", w.Code, w.Body.String())
	}
	var got models.Wallet
	db.DB.Where("user_id = ?", recipient.ID).First(&got)
	if got.BalanceLamports != 1_500_000_001 {
		t.Fatalf("recipient lamports = %d, want 1500000001 (exact, no float rounding)", got.BalanceLamports)
	}
	_ = uuid.Nil
}
