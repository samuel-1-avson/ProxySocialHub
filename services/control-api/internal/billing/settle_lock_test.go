package billing

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/testutil"
)

// SettleUsage runs on every pod. Without a per-session lock two pods could both read the same
// pending bytes and both debit the buyer before either deleted the Redis key.
// Updated for the W-16 owner-tokened lock: acquire returns (token, ok) and
// release only deletes the caller's own token.
func TestSettleLock_AdmitsOnePodAtATime(t *testing.T) {
	testutil.SetupTestRedis(t)

	token1, ok := acquireSettleLock("session-1")
	if !ok {
		t.Fatal("first pod could not take the lock")
	}
	if _, ok := acquireSettleLock("session-1"); ok {
		t.Fatal("a second pod took the lock for the same session")
	}
	if _, ok := acquireSettleLock("session-2"); !ok {
		t.Fatal("locks for different sessions must be independent")
	}

	// A foreign token must not release someone else's lock.
	releaseSettleLock("session-1", "not-the-owner")
	if _, ok := acquireSettleLock("session-1"); ok {
		t.Fatal("release with a foreign token freed the lock")
	}

	releaseSettleLock("session-1", token1)
	if _, ok := acquireSettleLock("session-1"); !ok {
		t.Fatal("the lock was not available after release")
	}
}
