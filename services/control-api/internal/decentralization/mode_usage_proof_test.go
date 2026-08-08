package decentralization

import "testing"

func TestRequireUsageProofBeforeSettle(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE", "true")
	if !RequireUsageProofBeforeSettle() {
		t.Fatal("expected true when env=true")
	}
	t.Setenv("PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE", "false")
	if RequireUsageProofBeforeSettle() {
		t.Fatal("expected false when env=false")
	}
	t.Setenv("PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE", "")
	if RequireUsageProofBeforeSettle() {
		t.Fatal("expected default false when unset")
	}
}
