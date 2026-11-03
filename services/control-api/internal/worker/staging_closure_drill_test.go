package worker

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/custody"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestStagingSecurityManagedClosurePreservesRecoverableKeys(t *testing.T) {
	testutil.SetupTestDB(t)
	t.Setenv("APP_ENV", "development")
	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("USE_GCP_KMS", "false")
	t.Setenv("USE_GCP_KMS_HOT", "false")
	t.Setenv("USE_AWS_KMS", "false")
	// A disposable oracle identity is required by the client constructor. This
	// fixture never sends a transaction; the only RPCs allowed below are reads.
	private := sol.NewWallet().PrivateKey
	keyInts := make([]int, len(private))
	for i, b := range private {
		keyInts[i] = int(b)
	}
	encoded, _ := json.Marshal(keyInts)
	path := filepath.Join(t.TempDir(), "synthetic-oracle.json")
	if err := os.WriteFile(path, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	var mode atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID     any               `json:"id"`
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
		}
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			w.WriteHeader(400)
			return
		}
		if mode.Load() == 2 {
			w.WriteHeader(503)
			return
		}
		var result any
		switch req.Method {
		case "getBalance":
			balance := 0
			if mode.Load() == 1 {
				balance = 1
			}
			result = map[string]any{"context": map[string]int{"slot": 1}, "value": balance}
		case "getTokenAccountsByOwner":
			accounts := []any{}
			var filter struct {
				Program string `json:"programId"`
			}
			if len(req.Params) > 1 {
				json.Unmarshal(req.Params[1], &filter)
			}
			if mode.Load() == 3 || (mode.Load() == 4 && strings.HasPrefix(filter.Program, "Tokenz")) {
				accounts = append(accounts, map[string]any{"pubkey": "11111111111111111111111111111111", "account": map[string]any{"lamports": 2039280, "owner": filter.Program, "data": []string{"", "base64"}, "executable": false, "rentEpoch": 0}})
			}
			result = map[string]any{"context": map[string]int{"slot": 1}, "value": accounts}
		default:
			t.Errorf("unexpected mutating or unrelated RPC method %s", req.Method)
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
	}))
	defer server.Close()
	oracle, err := solana.NewOracleClient(solana.Config{RPCEndpoints: []string{server.URL}, OracleKeypairPath: path, Network: "local-test"})
	if err != nil {
		t.Fatal(err)
	}
	previous := solana.GetOracleClient()
	solana.SetOracleClientForTest(oracle)
	t.Cleanup(func() { solana.SetOracleClientForTest(previous) })
	for _, scenario := range []struct {
		name               string
		mode               int32
		blocked, scheduled bool
	}{
		{"empty", 0, false, true},
		{"funded", 1, true, true},
		{"rpc_outage", 2, true, true},
		{"spl_account", 3, true, true},
		{"token2022_account", 4, true, true},
		{"funded_during_grace", 1, true, true},
		{"active_order", 0, true, true},
		{"cancelled", 0, false, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			mode.Store(scenario.mode)
			user := testutil.CreateTestUser(t, testutil.UniqueEmail("closure-drill"), "buyer")
			if err := db.DB.Model(&models.Wallet{}).Where("user_id = ?", user.ID).Updates(map[string]any{"balance_sol": 0, "balance_lamports": 0, "earnings_payable_lamports": 0}).Error; err != nil {
				t.Fatal(err)
			}
			kek, err := custody.NewLocalKEK(strings.Repeat("51", 32))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := custody.CreateSolanaWallet(db.DB, kek, user.ID); err != nil {
				t.Fatal(err)
			}
			if scenario.scheduled {
				if scenario.name == "funded_during_grace" {
					mode.Store(0)
					future := time.Now().Add(time.Hour)
					if err := db.DB.Model(user).Update("scheduled_deletion_at", future).Error; err != nil {
						t.Fatal(err)
					}
					if err := purgeUserAccount(user.ID, user.Email); err != nil {
						t.Fatal("grace period failed", err)
					}
					if _, err := custody.FindWallet(db.DB, user.ID); err != nil {
						t.Fatal("key removed during grace", err)
					}
					mode.Store(1)
				}
				due := time.Now().Add(-time.Hour)
				if err := db.DB.Model(user).Update("scheduled_deletion_at", due).Error; err != nil {
					t.Fatal(err)
				}
			}
			if scenario.name == "active_order" {
				seller := testutil.CreateTestUser(t, testutil.UniqueEmail("closure-provider"), "provider")
				listing := testutil.CreateTestListing(t, seller.ID)
				if err := db.DB.Create(&models.Order{BuyerID: user.ID, SellerID: seller.ID, ListingID: listing.ID, Status: models.OrderStatusActive, BandwidthGB: 1, PricePerGB: 1, TotalPrice: 1}).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := purgeUserAccount(user.ID, user.Email); (err != nil) != scenario.blocked {
				t.Fatalf("purge blocked=%v: %v", scenario.blocked, err)
			}
			var n int64
			if err := db.DB.Model(&models.EmbeddedWallet{}).Where("user_id = ?", user.ID).Count(&n).Error; err != nil {
				t.Fatal(err)
			}
			preserved := scenario.blocked || !scenario.scheduled
			if (n == 1) != preserved {
				t.Fatal("key preservation did not match closure result")
			}
			if preserved {
				signer, err := custody.NewSigner(db.DB, kek, user.ID)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := signer.Sign([]byte("staging closure recovery check")); err != nil {
					t.Fatal("preserved wallet cannot recover", err)
				}
			}
		})
	}
}
