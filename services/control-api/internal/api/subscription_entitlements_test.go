package api

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/models"
)

func TestEnsureBuyerBandwidthQuotaUnlimited(t *testing.T) {
	// Unit-level: EnsureBuyerBandwidthQuota with positive request and no DB is not exercised here.
	// Protect naming/constants used by entitlements.
	if models.SubscriptionActive != "active" {
		t.Fatal("unexpected active status")
	}
	if models.BillingMonthly != "monthly" {
		t.Fatal("unexpected billing cycle")
	}
}

func TestIntPtrHelper(t *testing.T) {
	p := intPtr(10)
	if p == nil || *p != 10 {
		t.Fatalf("intPtr failed: %v", p)
	}
}
