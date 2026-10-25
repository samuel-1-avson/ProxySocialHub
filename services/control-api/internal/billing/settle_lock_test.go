package billing

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/testutil"
)

// SettleUsage runs on every pod. Without a per-session lock two pods could both read the same
// pending bytes and both debit the buyer before either deleted the Redis key.
func TestSettleLock_AdmitsOnePodAtATime(t *testing.T) {
	testutil.SetupTestRedis(t)

	if !acquireSettleLock("session-1") {
		t.Fatal("first pod could not take the lock")
	}
	if acquireSettleLock("session-1") {
		t.Fatal("a second pod took the lock for the same session")
	}
	if !acquireSettleLock("session-2") {
		t.Fatal("locks for different sessions must be independent")
	}

	releaseSettleLock("session-1")
	if !acquireSettleLock("session-1") {
		t.Fatal("the lock was not available after release")
	}
}
