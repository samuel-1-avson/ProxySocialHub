package accountclosure

import (
	"context"
	"errors"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"testing"
)

func TestClosureRejectsFundsPendingPaymentsAndUnavailableChecks(t *testing.T) {
	tx, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	for _, schema := range []string{
		"CREATE TABLE wallets(user_id TEXT,balance_lamports INTEGER,balance_sol REAL,earnings_payable_lamports INTEGER)",
		"CREATE TABLE orders(buyer_id TEXT,seller_id TEXT,status TEXT)",
		"CREATE TABLE sessions(user_id TEXT,deleted_at DATETIME,status TEXT)",
		"CREATE TABLE cashouts(user_id TEXT,status TEXT)",
		"CREATE TABLE pending_payouts(provider_id TEXT,status TEXT)",
		"CREATE TABLE withdrawal_payout_queue(user_id TEXT,status TEXT)",
		"CREATE TABLE pending_transactions(user_id TEXT,status TEXT)",
		"CREATE TABLE session_intents(user_id TEXT,deleted_at DATETIME,lifecycle_state TEXT)",
		"CREATE TABLE embedded_wallets(id TEXT,user_id TEXT,chain TEXT,address TEXT,sealed_key BLOB,wrapped_dek BLOB,kek_id TEXT,created_at DATETIME)",
	} {
		if err := tx.Exec(schema).Error; err != nil {
			t.Fatal(err)
		}
	}
	uid := uuid.New()
	ctx := context.Background()
	if err := Check(ctx, tx, uid, true); err != nil {
		t.Fatal("empty account rejected", err)
	}
	if err := tx.Exec("INSERT INTO wallets VALUES(?,1,0,0)", uid).Error; err != nil {
		t.Fatal(err)
	}
	if err := Check(ctx, tx, uid, false); !errors.Is(err, ErrUnsettled) {
		t.Fatal("funded account allowed", err)
	}
	tx.Exec("DELETE FROM wallets")
	tx.Exec("INSERT INTO withdrawal_payout_queue VALUES(?,?)", uid, "paying")
	if err := Check(ctx, tx, uid, true); !errors.Is(err, ErrUnsettled) {
		t.Fatal("in-flight withdrawal allowed", err)
	}
	tx.Exec("DELETE FROM withdrawal_payout_queue")
	tx.Exec("INSERT INTO embedded_wallets(id,user_id,address) VALUES(?,?,?)", uuid.New(), uid, "11111111111111111111111111111111")
	if err := Check(ctx, tx, uid, true); err == nil {
		t.Fatal("managed key purge allowed without a chain verifier")
	}
	tx.Exec("DROP TABLE wallets")
	if err := Check(ctx, tx, uid, false); err == nil {
		t.Fatal("query failure authorized closure")
	}
}
