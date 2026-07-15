package catalog

import "errors"

var (
	ErrProductNotFound   = errors.New("catalog product not found")
	ErrOfferNotFound     = errors.New("catalog offer not found")
	ErrListingNotOwned   = errors.New("listing not found or not owned by seller")
	ErrListingDeleted    = errors.New("listing is deleted")
	ErrListingLinked     = errors.New("listing already linked to a catalog offer")
	ErrSlugTaken         = errors.New("slug already in use for this seller")
	ErrInvalidStatus     = errors.New("invalid catalog product status")
)
