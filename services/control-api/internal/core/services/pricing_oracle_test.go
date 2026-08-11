package services

import (
	"context"
	"testing"
)

func TestSuggestPriceResidentialUS(t *testing.T) {
	o := NewPricingOracle()
	s, err := o.SuggestPrice(context.Background(), "US", "residential")
	if err != nil {
		t.Fatal(err)
	}
	if s.Currency != "USD" {
		t.Fatalf("currency=%s", s.Currency)
	}
	// Traffic-first: under IPRoyal ~$1.75 / Bright PAYG.
	if s.SuggestedPrice < 0.70 || s.SuggestedPrice > 1.75 {
		t.Fatalf("suggested=%v want residential undercut band", s.SuggestedPrice)
	}
	if s.SoftCapPrice < s.SuggestedPrice {
		t.Fatalf("soft cap %v < suggested %v", s.SoftCapPrice, s.SuggestedPrice)
	}
	if s.HardCapPrice != ListingPriceHardCapUSD {
		t.Fatalf("hard cap=%v", s.HardCapPrice)
	}
}

func TestSuggestPriceDatacenterBelowResidential(t *testing.T) {
	o := NewPricingOracle()
	res, _ := o.SuggestPrice(context.Background(), "US", "residential")
	dc, _ := o.SuggestPrice(context.Background(), "US", "datacenter")
	if dc.SuggestedPrice >= res.SuggestedPrice {
		t.Fatalf("datacenter %v should be below residential %v", dc.SuggestedPrice, res.SuggestedPrice)
	}
}

func TestSuggestPriceMobilePremium(t *testing.T) {
	o := NewPricingOracle()
	s, err := o.SuggestPrice(context.Background(), "US", "mobile")
	if err != nil {
		t.Fatal(err)
	}
	if s.SuggestedPrice < 2.5 || s.SuggestedPrice > 6.0 {
		t.Fatalf("mobile suggested=%v want traffic-first mobile band", s.SuggestedPrice)
	}
}

func TestSuggestPriceUndercutsMidMarket(t *testing.T) {
	o := NewPricingOracle()
	s, _ := o.SuggestPrice(context.Background(), "US", "residential")
	// Mid-market centrals often list ~$3.50–8 entry; we must stay clearly below.
	if s.SuggestedPrice >= 2.0 {
		t.Fatalf("suggested=%v is not undercutting mid-market", s.SuggestedPrice)
	}
}

func TestValidateListingPriceHardCap(t *testing.T) {
	_, hard := ValidateListingPriceUSD(51, "US", "residential")
	if hard == "" {
		t.Fatal("expected hard reject above $50")
	}
	warn, hard := ValidateListingPriceUSD(5, "US", "residential")
	if hard != "" {
		t.Fatalf("unexpected hard reject: %s", hard)
	}
	if warn == "" {
		t.Fatal("expected soft-cap warning for $5 residential")
	}
}
