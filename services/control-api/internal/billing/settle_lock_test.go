package billing

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/testutil"
)

// SettleUsage runs on every pod. Without a per-session lock two pods could both read the same
// pending bytes and both debit the buyer before either deleted the Redis key.
// W-16: locks are owner-tokened - a release with the wrong token (e.g. a
// slow settler whose TTL expired) must not delete the next owner's lock.
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

	// Wrong-token release must NOT free the lock.
	releaseSettleLock("session-1", "someone-elses-token")
	if _, ok := acquireSettleLock("session-1"); ok {
		t.Fatal("wrong-token release freed another owner's lock")
	}

	releaseSettleLock("session-1", token1)
	if _, ok := acquireSettleLock("session-1"); !ok {
		t.Fatal("the lock was not available after release")
	}
}
