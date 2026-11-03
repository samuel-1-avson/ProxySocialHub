package gateways

import (
	"github.com/proxyhubb/control-api/internal/testutil"
	"os"
	"testing"
)

func TestDisabledOperatorStaysExcludedAfterReseeding(t *testing.T) {
	testutil.SetupTestDB(t)
	t.Setenv("PROXYHUB_SEED_GATEWAY_OPERATORS", "1")
	t.Setenv("GATEWAY_OP_A_STATUS", "active")
	t.Setenv("GATEWAY_OP_B_STATUS", "disabled")
	for restart := 0; restart < 2; restart++ {
		if err := SeedFromEnv(); err != nil {
			t.Fatal(err)
		}
		active, err := ListActive(false)
		if err != nil {
			t.Fatal(err)
		}
		foundA := false
		for _, operator := range active {
			if operator.Slug == "edge-b" {
				t.Fatal("disabled endpoint was re-enabled by restart")
			}
			if operator.Slug == "edge-a" {
				foundA = true
			}
		}
		if !foundA {
			t.Fatal("active primary endpoint was excluded")
		}
	}
}

func TestBondEnforceEnabled_DefaultOff(t *testing.T) {
	t.Setenv("PROXYHUB_GATEWAY_OPERATOR_BOND_ENFORCE", "")
	if BondEnforceEnabled() {
		t.Fatal("bond enforce should default off")
	}
	t.Setenv("PROXYHUB_GATEWAY_OPERATOR_BOND_ENFORCE", "true")
	if !BondEnforceEnabled() {
		t.Fatal("bond enforce should honor true")
	}
	t.Setenv("PROXYHUB_GATEWAY_OPERATOR_BOND_ENFORCE", "0")
	if BondEnforceEnabled() {
		t.Fatal("bond enforce should be off for 0")
	}
	t.Setenv("PROXYHUB_GATEWAY_OPERATOR_BOND_ENFORCE", "observe")
	if BondEnforceEnabled() {
		t.Fatal("observe must not omit unbonded")
	}
}

func TestNormalizeAddr(t *testing.T) {
	if got := normalizeAddr("https://proxy.example:3128"); got != "proxy.example:3128" {
		t.Fatalf("got %q", got)
	}
	if got := normalizeAddr("  http://h:1  "); got != "h:1" {
		t.Fatalf("got %q", got)
	}
}

func TestEnvOr(t *testing.T) {
	key := "GATEWAY_OP_TEST_ENVOR_" + t.Name()
	_ = os.Unsetenv(key)
	if got := envOr(key, "fallback"); got != "fallback" {
		t.Fatalf("got %q", got)
	}
	t.Setenv(key, "set")
	if got := envOr(key, "fallback"); got != "set" {
		t.Fatalf("got %q", got)
	}
}
