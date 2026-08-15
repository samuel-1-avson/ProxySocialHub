package api

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/catalog"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/providergate"
)

// DiscoveryHonesty describes how marketplace discovery is still centralized (Wave 3.2 / DISC-01 / W5.C.5).
type DiscoveryHonesty struct {
	CatalogSource           string `json:"catalog_source"`
	DelistAuthority         string `json:"delist_authority"`
	RegistryGateMode        string `json:"registry_gate_mode"`
	BrowseRegistryFilter    string `json:"browse_registry_filter"`
	ListingCommitmentMode   string `json:"listing_commitment_mode"`
	ListingCommitments      string `json:"listing_commitments"`
	Note                    string `json:"note"`
}

func discoveryHonestyMeta() DiscoveryHonesty {
	browseFilter := decentralization.BrowseRegistryFilterMode()
	commitmentMode := decentralization.ListingCommitmentMode()
	commitments := "ed25519_offer_hash"
	if commitmentMode != "off" {
		commitments = "ed25519_offer_hash+listing_commitment_pda"
	}
	catalogSource := catalog.Source()
	note := "Browse/map indexes are Postgres. Delist/reject is admin moderation, not on-chain. " +
		"listing_offer_hash is an off-chain Ed25519 commitment. ProviderRegistry gates session " +
		"activation when PROXYHUB_PROVIDER_REGISTRY_GATE=enforce."
	switch browseFilter {
	case "enforce":
		note += " Browse/map hard-filter (PROXYHUB_BROWSE_REGISTRY_FILTER=enforce) omits listings " +
			"without PG is_registered_on_chain — provider-level, not listing PDA."
	case "observe":
		note += " Browse registry filter is observe-only (annotations; no hard drop)."
	default:
		note += " Browse does not hard-filter by registry unless PROXYHUB_BROWSE_REGISTRY_FILTER=enforce."
	}
	switch commitmentMode {
	case "enforce":
		note += " Listing commitment enforce (PROXYHUB_LISTING_COMMITMENT=enforce) omits listings " +
			"without PG listing_commitment_on_chain — offer-hash PDA mirror, not a full on-chain catalog."
	case "observe":
		note += " Listing commitment observe anchors offer hashes on-chain best-effort and annotates browse."
	default:
		note += " Listing commitment PDA anchoring is off unless PROXYHUB_LISTING_COMMITMENT=observe|enforce."
	}
	if catalogSource == "postgres_cache" {
		note += " catalog_source=postgres_cache: a signed listing-commitment bundle is pinned; Postgres is a cache of that set."
	}
	return DiscoveryHonesty{
		CatalogSource:         catalogSource,
		DelistAuthority:       "platform_moderation",
		RegistryGateMode:      decentralization.ProviderRegistryGateMode(),
		BrowseRegistryFilter:  browseFilter,
		ListingCommitmentMode: commitmentMode,
		ListingCommitments:    commitments,
		Note:                  note,
	}
}

// filterListingsByBrowseRegistry drops unregistered supply when browse filter enforce is on.
// Uses PG-backed ProviderRegisteredOnChain hints (call after enrichListingsDiscoveryHints).
func filterListingsByBrowseRegistry(listings []models.ProxyListing) []models.ProxyListing {
	if !decentralization.BrowseRegistryFilterEnforce() || len(listings) == 0 {
		return listings
	}
	out := make([]models.ProxyListing, 0, len(listings))
	for _, l := range listings {
		if l.ProviderRegisteredOnChain != nil && *l.ProviderRegisteredOnChain {
			out = append(out, l)
		}
	}
	return out
}

// listingPassesBrowseRegistryFilter is false when enforce mode and listing is not registered.
func listingPassesBrowseRegistryFilter(listing *models.ProxyListing) bool {
	if listing == nil || !decentralization.BrowseRegistryFilterEnforce() {
		return true
	}
	return listing.ProviderRegisteredOnChain != nil && *listing.ProviderRegisteredOnChain
}

// filterListingsByListingCommitment drops listings without PDA mirror when commitment enforce is on.
func filterListingsByListingCommitment(listings []models.ProxyListing) []models.ProxyListing {
	if !decentralization.ListingCommitmentEnforce() || len(listings) == 0 {
		return listings
	}
	out := make([]models.ProxyListing, 0, len(listings))
	for _, l := range listings {
		if l.ListingCommitmentOnChain {
			out = append(out, l)
		}
	}
	return out
}

func listingPassesListingCommitmentFilter(listing *models.ProxyListing) bool {
	if listing == nil || !decentralization.ListingCommitmentEnforce() {
		return true
	}
	return listing.ListingCommitmentOnChain
}

type providerDiscoveryRow struct {
	ID                  uuid.UUID `gorm:"column:id"`
	UserID              uuid.UUID `gorm:"column:user_id"`
	IsRegisteredOnChain bool      `gorm:"column:is_registered_on_chain"`
	HasHotkey           bool      `gorm:"column:has_hotkey"`
	Hotkey              string    `gorm:"column:hotkey"`
}

// enrichListingsDiscoveryHints fills PG-backed registry/hotkey flags (no Solana RPC per row).
func enrichListingsDiscoveryHints(listings []models.ProxyListing) {
	if len(listings) == 0 || db.DB == nil {
		return
	}
	nodeIDs := make([]uuid.UUID, 0, len(listings))
	sellerIDs := make([]uuid.UUID, 0, len(listings))
	seenSeller := map[uuid.UUID]struct{}{}
	for _, l := range listings {
		if l.ProviderNodeID != nil && *l.ProviderNodeID != uuid.Nil {
			nodeIDs = append(nodeIDs, *l.ProviderNodeID)
		}
		if _, ok := seenSeller[l.SellerID]; !ok {
			seenSeller[l.SellerID] = struct{}{}
			sellerIDs = append(sellerIDs, l.SellerID)
		}
	}

	byNode := map[uuid.UUID]providerDiscoveryRow{}
	bySeller := map[uuid.UUID]providerDiscoveryRow{}

	if len(nodeIDs) > 0 {
		var rows []providerDiscoveryRow
		_ = db.DB.Raw(`
			SELECT id, user_id, COALESCE(is_registered_on_chain, false) AS is_registered_on_chain,
			       (COALESCE(TRIM(hotkey), '') <> '') AS has_hotkey,
			       COALESCE(hotkey, '') AS hotkey
			FROM provider_nodes
			WHERE deleted_at IS NULL AND id IN ?
		`, nodeIDs).Scan(&rows).Error
		for _, r := range rows {
			byNode[r.ID] = r
		}
	}
	if len(sellerIDs) > 0 {
		var rows []providerDiscoveryRow
		_ = db.DB.Raw(`
			SELECT DISTINCT ON (user_id)
			  id, user_id, COALESCE(is_registered_on_chain, false) AS is_registered_on_chain,
			  (COALESCE(TRIM(hotkey), '') <> '') AS has_hotkey,
			  COALESCE(hotkey, '') AS hotkey
			FROM provider_nodes
			WHERE deleted_at IS NULL AND user_id IN ?
			ORDER BY user_id,
			  CASE WHEN status = 'online' THEN 0 ELSE 1 END,
			  last_seen_at DESC NULLS LAST,
			  created_at DESC
		`, sellerIDs).Scan(&rows).Error
		for _, r := range rows {
			bySeller[r.UserID] = r
		}
	}

	for i := range listings {
		var row providerDiscoveryRow
		ok := false
		if listings[i].ProviderNodeID != nil {
			if r, found := byNode[*listings[i].ProviderNodeID]; found {
				row, ok = r, true
			}
		}
		if !ok {
			if r, found := bySeller[listings[i].SellerID]; found {
				row, ok = r, true
			}
		}
		if !ok {
			continue
		}
		reg := row.IsRegisteredOnChain
		hot := row.HasHotkey
		listings[i].ProviderRegisteredOnChain = &reg
		listings[i].ProviderHasHotkey = &hot
	}
}

// maybeEnrichListingRegistryLive optionally reads on-chain ProviderRegistry for a single listing
// when include contains "registry" (Wave 3.2 — one RPC).
func maybeEnrichListingRegistryLive(ctx context.Context, include string, listing *models.ProxyListing) {
	if listing == nil || !includeHasToken(include, "registry") {
		return
	}
	var hotkey string
	if listing.ProviderNodeID != nil && db.DB != nil {
		_ = db.DB.Model(&models.ProviderNode{}).
			Select("hotkey").
			Where("id = ? AND deleted_at IS NULL", *listing.ProviderNodeID).
			Scan(&hotkey).Error
	}
	if strings.TrimSpace(hotkey) == "" && db.DB != nil {
		_ = db.DB.Raw(`
			SELECT COALESCE(hotkey, '') FROM provider_nodes
			WHERE user_id = ? AND deleted_at IS NULL
			ORDER BY CASE WHEN status = 'online' THEN 0 ELSE 1 END, last_seen_at DESC NULLS LAST
			LIMIT 1
		`, listing.SellerID).Scan(&hotkey).Error
	}
	node := &models.ProviderNode{Hotkey: strings.TrimSpace(hotkey)}
	if listing.ProviderNodeID != nil {
		node.ID = *listing.ProviderNodeID
	}
	live, age, err := providergate.LiveStatus(ctx, node)
	if err != nil {
		live = false
	}
	listing.RegistryLive = &live
	if age > 0 {
		secs := int64(age.Seconds())
		listing.RegistryHeartbeatAgeSecs = &secs
	}
}

func includeHasToken(include, token string) bool {
	include = strings.ToLower(strings.TrimSpace(include))
	token = strings.ToLower(strings.TrimSpace(token))
	if include == "" || token == "" {
		return false
	}
	for _, part := range strings.Split(include, ",") {
		if strings.TrimSpace(part) == token {
			return true
		}
	}
	return false
}
