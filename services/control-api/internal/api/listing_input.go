package api

import (
	"errors"
	"fmt"
	"strings"

	"github.com/go-playground/validator/v10"
)

// listingProtocolOrder is the canonical order of the protocols a listing can
// offer. A listing stores its protocols as a comma-joined list in this order
// (for example "http,socks5"), so the same choice always hashes the same way
// in signed offers.
var listingProtocolOrder = []string{"http", "https", "socks5"}

// normalizeListingProtocols accepts one protocol or a comma-separated list,
// in any case and order, and returns the canonical comma-joined list. When
// the input is unusable it returns a message for the seller instead.
func normalizeListingProtocols(raw string) (normalized, problem string) {
	chosen := map[string]bool{}
	for _, part := range strings.FieldsFunc(strings.ToLower(raw), func(r rune) bool {
		return r == ',' || r == ' ' || r == ';'
	}) {
		known := false
		for _, p := range listingProtocolOrder {
			if part == p {
				known = true
				break
			}
		}
		if !known {
			return "", fmt.Sprintf("Unknown protocol %q. Choose from HTTP, HTTPS and SOCKS5.", part)
		}
		chosen[part] = true
	}
	if len(chosen) == 0 {
		return "", "Choose at least one protocol."
	}
	out := make([]string, 0, len(chosen))
	for _, p := range listingProtocolOrder {
		if chosen[p] {
			out = append(out, p)
		}
	}
	return strings.Join(out, ","), ""
}

// listingFieldNames maps request struct fields to the labels sellers see.
var listingFieldNames = map[string]string{
	"Title":                "Offer title",
	"Description":          "Description",
	"ProxyType":            "Proxy type",
	"Protocol":             "Protocol",
	"ISP":                  "Internet provider",
	"PricePerGB":           "USD per GB",
	"MinPurchaseGB":        "Minimum purchase",
	"AvailableBandwidthGB": "Available bandwidth",
	"MaxConcurrency":       "Concurrent connections",
	"BulkDiscounts":        "Bulk discounts",
	"Status":               "Status",
}

// listingRequestError turns a request-binding failure into a sentence a
// seller can act on, instead of the raw validator text.
func listingRequestError(err error) string {
	var verrs validator.ValidationErrors
	if !errors.As(err, &verrs) || len(verrs) == 0 {
		return "The offer could not be read. Check the fields and try again."
	}
	fe := verrs[0]
	name := listingFieldNames[fe.Field()]
	if name == "" {
		name = fe.Field()
	}
	textual := fe.Kind().String() == "string"
	switch fe.Tag() {
	case "required":
		return name + " is required."
	case "min":
		if textual {
			return fmt.Sprintf("%s must be at least %s characters.", name, fe.Param())
		}
		return fmt.Sprintf("%s must be at least %s.", name, fe.Param())
	case "max":
		if textual {
			return fmt.Sprintf("%s can be at most %s characters.", name, fe.Param())
		}
		return fmt.Sprintf("%s can be at most %s.", name, fe.Param())
	case "gt":
		return fmt.Sprintf("%s must be more than %s.", name, fe.Param())
	case "gte":
		return fmt.Sprintf("%s must be %s or more.", name, fe.Param())
	case "lte":
		return fmt.Sprintf("%s can be at most %s.", name, fe.Param())
	case "oneof":
		return fmt.Sprintf("%s must be one of: %s.", name, strings.ReplaceAll(fe.Param(), " ", ", "))
	}
	return name + " is not valid."
}
