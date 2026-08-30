package models

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestToPublicProfileOmitsKYCAndISP(t *testing.T) {
	isp := "CLOUDFLARE, INC."
	loc := "@global"
	u := User{
		KYCStatus: KYCStatusApproved,
		ISP:       &isp,
		Location:  &loc,
		Verified:  false,
		TrustTier: TrustTierVerified,
		IsOnline:  true,
	}

	raw, err := json.Marshal(u.ToPublicProfile())
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	if strings.Contains(s, `"kyc_status"`) {
		t.Fatalf("public profile leaked kyc_status: %s", s)
	}
	if strings.Contains(s, "CLOUDFLARE") || strings.Contains(s, `"isp"`) {
		t.Fatalf("public profile leaked isp: %s", s)
	}
	if !strings.Contains(s, `"verified":false`) {
		t.Fatalf("expected verified=false, got %s", s)
	}
	if !strings.Contains(s, `"is_online":true`) {
		t.Fatalf("expected is_online, got %s", s)
	}

	self, err := json.Marshal(u.ToSelfProfile())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(self), `"kyc_status":"approved"`) {
		t.Fatalf("self profile should include kyc_status, got %s", self)
	}
	if strings.Contains(string(self), "CLOUDFLARE") {
		t.Fatalf("self profile should not include isp: %s", self)
	}
}
