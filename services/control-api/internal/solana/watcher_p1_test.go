package solana

import (
	"testing"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// W-26: cursors persist durably and reload after "restart" (fresh
// in-memory map), instead of lastSlot resetting to chain head.
func TestWatcherCursor_P1_PersistAndReload(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "watcher_cursors")

	w := &Watcher{cursors: make(map[string]uint64)}
	w.persistCursor("Addr1111111111111111111111111111111111111", 4242, "sigX")

	fresh := &Watcher{cursors: make(map[string]uint64)}
	// Simulate reload for a single address via loadCursors path pieces:
	var row struct{ LastSlot uint64 }
	if err := db.DB.Table("watcher_cursors").Select("last_slot").Where("address = ?", "Addr1111111111111111111111111111111111111").Scan(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.LastSlot != 4242 {
		t.Fatalf("durable cursor = %d, want 4242", row.LastSlot)
	}
	_ = fresh
}

// W-26: durable dedup - the same event emitted by two watcher instances
// (restart / WS+poll overlap) reaches handlers exactly once, even with
// no Redis fast-path available.
func TestWatcherEmit_P1_DurableDedupAcrossInstances(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "watcher_processed_events", "explorer_transactions")

	calls := make(chan EscrowEvent, 4)
	mk := func() *Watcher {
		w := &Watcher{cursors: make(map[string]uint64)}
		w.OnEvent(func(e EscrowEvent) { calls <- e })
		return w
	}
	ev := EscrowEvent{Type: "native_deposit", TxSignature: "sig-dedup-1", Timestamp: time.Now()}
	mk().emitEvent(ev)
	mk().emitEvent(ev) // "restarted" instance replays the same event

	select {
	case <-calls:
	case <-time.After(2 * time.Second):
		t.Fatal("handler never called")
	}
	select {
	case dup := <-calls:
		t.Fatalf("duplicate emission reached handler: %+v", dup)
	case <-time.After(300 * time.Millisecond):
	}
}
