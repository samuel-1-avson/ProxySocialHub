package models

import "encoding/json"

// Node and proof identifiers can link a storefront to infrastructure and public
// wallets. Keep verification state while withholding the linking material from
// general JSON responses; settlement has its own authenticated order contract.
func (l ProxyListing) MarshalJSON() ([]byte, error) {
	type listingJSON ProxyListing
	safe := listingJSON(l)
	safe.ProviderNodeID = nil
	safe.ListingOfferHash = ""
	safe.ListingOfferSignature = ""
	safe.ListingOfferSigner = ""
	safe.ListingOfferNonce = ""
	safe.ListingOfferVerificationError = ""
	safe.ListingCommitmentPDA = ""
	safe.ListingCommitmentTx = ""
	return json.Marshal(safe)
}
