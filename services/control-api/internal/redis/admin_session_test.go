package redis

import (
	"testing"
	"time"
)

func TestAdminSessionBlocklist(t *testing.T) {
	useMiniredisClient(t)

	if IsAdminSessionBlocked("jti-1") {
		t.Fatal("an unknown session must not read as blocked")
	}
	if err := BlockAdminSession("jti-1", time.Minute); err != nil {
		t.Fatalf("block: %v", err)
	}
	if !IsAdminSessionBlocked("jti-1") {
		t.Fatal("blocked session reads as active")
	}
	if IsAdminSessionBlocked("jti-2") {
		t.Fatal("blocking one session must not block another")
	}
	if IsAdminSessionBlocked("") {
		t.Fatal("an empty id is never blocked")
	}
}
