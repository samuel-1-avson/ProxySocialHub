package api

import (
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func seedDueOutboxRows(t *testing.T, n int) map[uuid.UUID]bool {
	t.Helper()
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("outbox-claim"), "buyer")
	ids := make(map[uuid.UUID]bool, n)
	for i := 0; i < n; i++ {
		row := models.CompensationOutbox{
			Kind:        models.CompensationKindWithdrawalRefund,
			UserID:      user.ID,
			AmountSOL:   0.1,
			ReferenceID: "claim-" + uuid.NewString(),
			Status:      models.CompensationStatusPending,
			NextRetryAt: time.Now().UTC().Add(-time.Minute),
		}
		if err := db.DB.Create(&row).Error; err != nil {
			t.Fatalf("seed outbox row: %v", err)
		}
		ids[row.ID] = true
	}
	return ids
}

func prepareOutboxTable(t *testing.T) {
	t.Helper()
	testutil.SetupTestDB(t)
	if err := db.DB.AutoMigrate(&models.CompensationOutbox{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.DB.Exec("DELETE FROM compensation_outbox").Error; err != nil {
		t.Fatalf("clear outbox: %v", err)
	}
}

// Two pods running the outbox worker both read the same due rows and could settle or refund
// one escrow twice. Claiming now leases the rows, so a second claim sees none of them.
func TestClaimDueOutboxEntries_LeasesRowsSoTheyAreClaimedOnce(t *testing.T) {
	prepareOutboxTable(t)
	seedDueOutboxRows(t, 3)

	now := time.Now().UTC()
	first, err := claimDueOutboxEntries(10, now)
	if err != nil || len(first) != 3 {
		t.Fatalf("first claim returned %d rows (err %v), want 3", len(first), err)
	}
	second, err := claimDueOutboxEntries(10, now)
	if err != nil || len(second) != 0 {
		t.Fatalf("second claim returned %d rows (err %v), want 0 while leased", len(second), err)
	}

	// After the lease runs out the rows are due again (a crashed worker's rows are retried).
	later := now.Add(outboxClaimLease + time.Second)
	third, err := claimDueOutboxEntries(10, later)
	if err != nil || len(third) != 3 {
		t.Fatalf("claim after the lease returned %d rows (err %v), want 3", len(third), err)
	}
}

func TestClaimDueOutboxEntries_ConcurrentWorkersNeverShareARow(t *testing.T) {
	prepareOutboxTable(t)
	want := seedDueOutboxRows(t, 8)

	var mu sync.Mutex
	seen := map[uuid.UUID]int{}
	var wg sync.WaitGroup
	for w := 0; w < 6; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rows, err := claimDueOutboxEntries(3, time.Now().UTC())
			if err != nil {
				t.Errorf("claim: %v", err)
				return
			}
			mu.Lock()
			for _, r := range rows {
				seen[r.ID]++
			}
			mu.Unlock()
		}()
	}
	wg.Wait()

	for id, n := range seen {
		if n != 1 {
			t.Fatalf("row %s was claimed by %d workers", id, n)
		}
		if !want[id] {
			t.Fatalf("claimed a row that was never seeded: %s", id)
		}
	}
	if len(seen) != len(want) {
		t.Fatalf("workers claimed %d of %d due rows", len(seen), len(want))
	}
}
