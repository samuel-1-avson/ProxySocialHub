package models

import (
	"encoding/json"
	"github.com/google/uuid"
	"strings"
	"testing"
)

func TestPrivateRecordsAndPublicMediaDoNotExposeTrackersOrLinkingProofs(t *testing.T) {
	email := "private@example.test"
	wallet := "private-wallet"
	tax := "private-tax"
	tracker := "https://tracking.example.test/pixel.png"
	alias := "random_alias"
	u := User{ID: uuid.New(), Username: &alias, Email: email, WalletAddress: &wallet, TaxID: &tax, AvatarURL: &tracker, ProfilePublic: true}
	raw, err := json.Marshal(u)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{email, wallet, tax, tracker} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("public account leak", secret)
		}
	}
	t.Setenv("PROFILE_MEDIA_ORIGINS", "https://media.example.test")
	if !SafeProfileMedia("https://media.example.test/avatar.png") || SafeProfileMedia("https://media.example.test.evil.test/avatar.png") || SafeProfileMedia("https://media.example.test@evil.test/a") || SafeProfileMedia("data:image/svg+xml;base64,PHN2Zz4=") {
		t.Fatal("media origin restriction bypass")
	}
	node := uuid.New()
	listing := ProxyListing{ProviderNodeID: &node, ListingOfferHash: "linking-hash", ListingOfferSigner: wallet, ListingOfferSignature: "signature", ListingCommitmentPDA: "linking-pda", ListingOfferVerified: true}
	raw, err = json.Marshal(listing)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{node.String(), wallet, "linking-hash", "linking-pda", "signature"} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("listing proof linked infrastructure", secret)
		}
	}
	if !strings.Contains(string(raw), `"listing_offer_verified":true`) {
		t.Fatal("verification state was lost")
	}
}
