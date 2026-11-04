"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Bookmark,
  Check,
  Gauge,
  GitCompareArrows,
  Layers,
  Lock,
  MapPin,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useHydrated } from "@/hooks/useHydrated";
import {
  getListings,
  getListingFacets,
  getSavedListings,
  saveListing,
  unsaveListing,
  marketplaceKeys,
  type Listing,
  type ListingFilters,
} from "@/lib/api/marketplace";
import { CatalogProductBadge } from "@/components/marketplace/CatalogProductBadge";
import {
  displayListingTitle,
  isMaskedLocation,
  listingShowsCatalogSubtitle,
} from "@/lib/listing-display";
import { Modal } from "@/components/patterns/Modal";
import { LazyBuyListingModal as BuyListingModal } from "@/components/marketplace/LazyBuyListingModal";
import {
  PageHeading,
  Status,
  Loading,
  DataError,
  EmptyState,
  amount,
  countryName,
} from "@/components/workspace/Patterns";
import { listingProtocolLabel } from "@/lib/listing-protocols";

export function Marketplace() {
  const params = useSearchParams();
  const router = useRouter();
  const client = useQueryClient();
  const { isAuthenticated, user } = useAuth();
  const savedView = params.get("filter") === "saved";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const country = (params.get("country") || "").toUpperCase();
  const proxyType = params.get("type") || "";
  const maxPrice = params.get("max_price") || "";
  const sort = params.get("sort") || "newest";
  const [details, setDetails] = useState<Listing | null>(null);
  const [checkout, setCheckout] = useState<Listing | null>(null);
  const [compare, setCompare] = useState<Listing[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const filters: ListingFilters = {
    page,
    limit: 20,
    sort_by: sort,
    country: country || undefined,
    proxy_type: proxyType || undefined,
    ...(maxPrice && Number.isFinite(Number(maxPrice))
      ? { max_price: Number(maxPrice) }
      : {}),
  };
  const listings = useQuery({
    queryKey: marketplaceKeys.listings(filters),
    queryFn: () => getListings(filters),
    enabled: !savedView,
    staleTime: 15_000,
  });
  const facets = useQuery({
    queryKey: marketplaceKeys.facets(),
    queryFn: getListingFacets,
    staleTime: 60_000,
  });
  const saved = useQuery({
    queryKey: [...marketplaceKeys.saved(), user?.id, savedView ? page : 1],
    queryFn: () => getSavedListings(savedView ? page : 1, 20),
    enabled: isAuthenticated,
    staleTime: 15_000,
  });
  const savedIds = new Set(
    saved.data?.saved.map((entry) => entry.listing_id) ?? [],
  );
  const saving = useMutation({
    mutationFn: ({ id, remove }: { id: string; remove: boolean }) =>
      remove ? unsaveListing(id) : saveListing(id),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: marketplaceKeys.saved() }),
  });
  const rows = savedView
    ? (saved.data?.saved.flatMap((entry) =>
        entry.listing ? [entry.listing] : [],
      ) ?? [])
    : (listings.data?.listings ?? []);
  const total = savedView
    ? (saved.data?.total ?? 0)
    : (listings.data?.total ?? 0);
  const query = savedView ? saved : listings;
  function update(next: Record<string, string>) {
    const search = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) search.set(key, value);
      else search.delete(key);
    }
    if (!("page" in next)) search.delete("page");
    router.push(`/marketplace${search.size ? `?${search}` : ""}`);
  }
  function toggleCompare(listing: Listing) {
    setCompare((current) =>
      current.some((item) => item.id === listing.id)
        ? current.filter((item) => item.id !== listing.id)
        : current.length < 3
          ? [...current, listing]
          : current,
    );
  }
  return (
    <div className="ui-page">
      <PageHeading
        eyebrow="Buyer workspace"
        title="Marketplace"
        description="Clear pricing. Useful evidence. The capacity you need."
        actions={
          <Link className="ui-button secondary" href="/marketplace/map">
            <MapPin size={15} aria-hidden="true" />
            Map view
          </Link>
        }
      />
      <nav className="ui-tabs" aria-label="Marketplace views">
        <Link
          href="/marketplace"
          className={!savedView ? "active" : ""}
          aria-current={!savedView ? "page" : undefined}
        >
          Browse
        </Link>
        <Link
          href="/marketplace?filter=saved"
          className={savedView ? "active" : ""}
          aria-current={savedView ? "page" : undefined}
        >
          Saved
        </Link>
      </nav>
      {!savedView && (
        <MarketplaceFilters
          key={[country, proxyType, maxPrice, sort].join(":")}
          country={country}
          proxyType={proxyType}
          maxPrice={maxPrice}
          sort={sort}
          countries={facets.data?.countries ?? []}
          onApply={update}
        />
      )}
      {saving.isError && <DataError error={saving.error} />}
      {savedView && !isAuthenticated ? (
        <EmptyState
          title="Keep useful offers close."
          description="Sign in to save listings and return to them later."
          href="/login?next=%2Fmarketplace%3Ffilter%3Dsaved"
          action="Sign in"
        />
      ) : (
        <>
          <p className="ui-filter-summary">
            {query.isSuccess
              ? `${total} ${total === 1 ? "offer" : "offers"}`
              : query.isError
                ? "Inventory unavailable"
                : "Loading inventory…"}
            {country ? ` · ${countryName(country)}` : ""}
            {maxPrice ? ` · up to $${maxPrice} / GB` : ""}
            {(country || proxyType || maxPrice) && (
              <button
                className="ui-button ghost small ml-4"
                onClick={() => {
                  update({ country: "", type: "", max_price: "" });
                }}
              >
                Clear filters
              </button>
            )}
          </p>
          {compare.length > 0 && (
            <div
              className="marketplace-compare-bar"
              role="region"
              aria-label="Selected offers"
            >
              <div className="marketplace-compare-label">
                <GitCompareArrows size={18} aria-hidden="true" />
                <div>
                  <strong>{compare.length} selected</strong>
                  <p>Compare up to three offers</p>
                </div>
              </div>
              <div className="marketplace-compare-items">
                {compare.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => toggleCompare(item)}
                    aria-label={
                      "Remove " + displayListingTitle(item) + " from comparison"
                    }
                  >
                    {listingShowsCatalogSubtitle(item)
                      ? item.title
                      : displayListingTitle(item)}
                    <X size={12} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <button
                className="ui-button small"
                disabled={compare.length < 2}
                onClick={() => setCompareOpen(true)}
              >
                Compare offers
              </button>
              <button
                className="ui-button ghost small"
                onClick={() => setCompare([])}
              >
                Clear
              </button>
            </div>
          )}
          {query.isLoading && <Loading label="Loading available offers…" />}
          {query.isError && (
            <DataError error={query.error} retry={() => void query.refetch()} />
          )}
          {query.isSuccess && rows.length === 0 && (
            <EmptyState
              title={
                savedView
                  ? "No saved offers yet."
                  : "No proxies match these filters."
              }
              description={
                savedView
                  ? "Save an offer while browsing and it will appear here."
                  : "Try another location or proxy type. Inventory is shown as reported by the marketplace."
              }
              href="/marketplace"
              action="Browse proxies"
            />
          )}
          <section className="offer-grid" aria-label="Proxy offers">
            {rows.map((listing) => {
              const selected = compare.some((item) => item.id === listing.id);
              const isSaved = savedIds.has(listing.id);
              return (
                <article
                  className={"offer-card" + (selected ? " is-selected" : "")}
                  key={listing.id}
                  data-testid={"listing-" + listing.id}
                >
                  <div className="offer-card-top">
                    <span
                      className="offer-region"
                      aria-label={countryName(listing.country)}
                    >
                      {isMaskedLocation(listing.country) ? (
                        <Lock size={16} aria-hidden="true" />
                      ) : (
                        listing.country || (
                          <MapPin size={18} aria-hidden="true" />
                        )
                      )}
                    </span>
                    <Status
                      tone={listing.status === "active" ? "good" : "neutral"}
                    >
                      {listing.status === "active"
                        ? "Listed"
                        : listing.status.replace(/_/g, " ")}
                    </Status>
                    <button
                      className={"offer-save" + (isSaved ? " is-saved" : "")}
                      disabled={saving.isPending}
                      aria-pressed={isSaved}
                      aria-label={isSaved ? "Unsave offer" : "Save offer"}
                      onClick={() => {
                        if (!isAuthenticated) {
                          router.push(
                            "/login?next=" + encodeURIComponent("/marketplace"),
                          );
                          return;
                        }
                        saving.mutate({ id: listing.id, remove: isSaved });
                      }}
                    >
                      <Bookmark
                        size={17}
                        fill={isSaved ? "currentColor" : "none"}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                  <div className="offer-card-heading">
                    <p className="offer-location">
                      {countryName(listing.country)}
                      {listing.city ? " · " + listing.city : ""}
                    </p>
                    <h2>{displayListingTitle(listing)}</h2>
                    {listingShowsCatalogSubtitle(listing) && (
                      <p className="offer-subtitle">{listing.title}</p>
                    )}
                    {listing.seller && (
                      <p className="offer-provider">
                        From{" "}
                        {listing.seller.display_name || listing.seller.username}
                      </p>
                    )}
                    <CatalogProductBadge product={listing.catalog_product} />
                  </div>
                  <div className="offer-type-line">
                    <span>{listing.proxy_type}</span>
                    <span>{listing.protocol ? listingProtocolLabel(listing.protocol) : "Protocol not specified"}</span>
                  </div>
                  <dl className="offer-specs">
                    <div>
                      <dt>
                        <Layers size={13} aria-hidden="true" />
                        Capacity
                      </dt>
                      <dd>
                        {amount(listing.available_bandwidth_gb)} <span>GB</span>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Gauge size={13} aria-hidden="true" />
                        Latency
                      </dt>
                      <dd>
                        {listing.avg_latency_ms > 0 ? (
                          <>
                            {amount(listing.avg_latency_ms)} <span>ms</span>
                          </>
                        ) : (
                          <span>Not measured</span>
                        )}
                        <small>
                          {listing.avg_latency_ms > 0
                            ? ["gateway", "explorer", "assessment"].includes(
                                listing.sla_source || "",
                              )
                              ? "Measured"
                              : "Reported"
                            : "No measurement"}
                        </small>
                      </dd>
                    </div>
                    <div>
                      <dt>Minimum</dt>
                      <dd>
                        {amount(listing.min_purchase_gb)} <span>GB</span>
                      </dd>
                    </div>
                  </dl>
                  {listing.quality_assessment && <p className="ui-note">{listing.quality_assessment.status === "unavailable" ? "Latest assessment unavailable" : `${listing.quality_assessment.tier} · ${amount(listing.quality_assessment.quality_score, 1)}/100 · provisional`} · confidence {Math.round(listing.quality_assessment.confidence * 100)}%</p>}
                  <div className="offer-evidence">
                    <span>
                      {listing.listing_offer_verified ? (
                        <ShieldCheck
                          size={14}
                          className="text-success"
                          aria-hidden="true"
                        />
                      ) : (
                        <Shield size={14} aria-hidden="true" />
                      )}
                      {listing.listing_offer_verified
                        ? "Provider-signed offer"
                        : "Signature not verified"}
                    </span>
                    <span>
                      {(listing.seller?.reviews_count ?? 0) > 0 &&
                      (listing.seller?.avg_rating ?? 0) > 0
                        ? amount(listing.seller?.avg_rating, 1) +
                          " · " +
                          listing.seller?.reviews_count +
                          " reviews"
                        : "No reviews yet"}
                    </span>
                  </div>
                  <div className="offer-card-bottom">
                    <div className="offer-price">
                      <small>Price per GB</small>
                      <strong>
                        ${amount(listing.price_per_gb, 4)}
                        <span> USD</span>
                      </strong>
                    </div>
                    <button
                      className="ui-button small"
                      onClick={() => setDetails(listing)}
                    >
                      View details
                      <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <button
                    className="offer-compare"
                    onClick={() => toggleCompare(listing)}
                    aria-pressed={selected}
                    disabled={!selected && compare.length >= 3}
                  >
                    <span>
                      {selected ? (
                        <Check size={12} aria-hidden="true" />
                      ) : (
                        <PlusCompare />
                      )}
                    </span>
                    {selected ? "Selected for comparison" : "Add to comparison"}
                  </button>
                </article>
              );
            })}
          </section>
          {total > 20 && (
            <div className="ui-pagination">
              <button
                className="ui-button secondary small"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) })}
              >
                Previous
              </button>
              <span>
                Page {page} of {Math.ceil(total / 20)}
              </span>
              <button
                className="ui-button secondary small"
                disabled={page * 20 >= total}
                onClick={() => update({ page: String(page + 1) })}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
      <Modal
        open={Boolean(details)}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
        title={details ? displayListingTitle(details) : "Offer details"}
        size="xl"
      >
        {details && (
          <div className="ui-page">
            <p className="ui-note">
              {details.description ||
                `${countryName(details.country)} · ${details.proxy_type} capacity`}
            </p>
            <div>
              <div className="ui-row">
                <span>Price per GB</span>
                <strong>${amount(details.price_per_gb, 4)}</strong>
              </div>
              <div className="ui-row">
                <span>Minimum purchase</span>
                <span>{amount(details.min_purchase_gb)} GB</span>
              </div>
              <div className="ui-row">
                <span>Reported capacity</span>
                <span>{amount(details.available_bandwidth_gb)} GB</span>
              </div>
              <div className="ui-row">
                <span>Offer signature</span>
                <Status
                  tone={details.listing_offer_verified ? "good" : "neutral"}
                >
                  {details.listing_offer_verified
                    ? "Verified signature"
                    : "Not verified"}
                </Status>
              </div>
            </div>
            <p className="ui-note">
              Exact network identity stays private until authorized session
              access. Listing availability and measured node health are
              different signals.
            </p>
            <div className="ui-actions">
              <button
                className="ui-button"
                disabled={details.status !== "active"}
                onClick={() => {
                  if (!isAuthenticated) {
                    router.push(
                      `/login?next=${encodeURIComponent(`/marketplace/${details.id}`)}`,
                    );
                    return;
                  }
                  setCheckout(details);
                  setDetails(null);
                }}
              >
                Buy bandwidth →
              </button>
              <Link
                className="ui-button secondary"
                href={`/marketplace/${details.id}`}
              >
                Full listing & reviews
              </Link>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={compareOpen}
        onOpenChange={setCompareOpen}
        title="Compare offers"
        size="xl"
      >
        <div
          className="ui-table-wrap"
          role="region"
          tabIndex={0}
          aria-label="Offer comparison"
        >
          <table className="ui-table">
            <thead>
              <tr>
                <th>Offer</th>
                <th>Price / GB</th>
                <th>Latency</th>
                <th>Signed offer</th>
              </tr>
            </thead>
            <tbody>
              {compare.map((item) => (
                <tr key={item.id}>
                  <td>
                    {displayListingTitle(item)}
                    {listingShowsCatalogSubtitle(item) && <p>{item.title}</p>}
                    {item.seller && (
                      <p>
                        From {item.seller.display_name || item.seller.username}
                      </p>
                    )}
                  </td>
                  <td>${amount(item.price_per_gb, 4)}</td>
                  <td>
                    {item.avg_latency_ms > 0
                      ? `${amount(item.avg_latency_ms)} ms · ${["gateway", "explorer"].includes(item.sla_source || "") ? "measured" : "reported"}`
                      : "Not measured"}
                  </td>
                  <td>
                    {item.listing_offer_verified ? "Verified" : "Not verified"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
      {checkout && (
        <BuyListingModal
          listing={checkout}
          surface="browse"
          onClose={() => setCheckout(null)}
          onSuccess={(id) => {
            void client.invalidateQueries({
              queryKey: marketplaceKeys.orders(),
            });
            router.push(`/app/connections/${id}`);
          }}
        />
      )}
    </div>
  );
}

function PlusCompare() {
  return <GitCompareArrows size={12} aria-hidden="true" />;
}

function MarketplaceFilters({
  country,
  proxyType,
  maxPrice,
  sort,
  countries,
  onApply,
}: {
  country: string;
  proxyType: string;
  maxPrice: string;
  sort: string;
  countries: { value: string }[];
  onApply: (next: Record<string, string>) => void;
}) {
  const hydrated = useHydrated();
  const [draftCountry, setDraftCountry] = useState(country);
  const [draftType, setDraftType] = useState(proxyType);
  const [draftPrice, setDraftPrice] = useState(maxPrice);
  const [draftSort, setDraftSort] = useState(sort);
  const [moreOpen, setMoreOpen] = useState(false);
  function apply() {
    onApply({
      country: draftCountry.trim().toUpperCase(),
      type: draftType,
      max_price: draftPrice,
      sort: draftSort,
    });
    setMoreOpen(false);
  }
  return (
    <section
      className="marketplace-filter-panel"
      aria-label="Filter available offers"
    >
      <div className="marketplace-filter-heading">
        <SlidersHorizontal size={16} aria-hidden="true" />
        <strong>Find your capacity</strong>
        <span>Filter by location, type, and price</span>
      </div>
      <form
        className="ui-filters"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <label className="ui-field">
          Location
          <input
            disabled={!hydrated}
            className="ui-input"
            aria-label="Country (ISO)"
            data-testid="marketplace-filter-country"
            value={draftCountry}
            onChange={(event) =>
              setDraftCountry(event.target.value.toUpperCase())
            }
            placeholder="All locations"
            maxLength={2}
            list="marketplace-countries"
          />
          <datalist id="marketplace-countries">
            {countries.map((item) => (
              <option key={item.value} value={item.value}>
                {countryName(item.value)}
              </option>
            ))}
          </datalist>
        </label>
        <label className="ui-field">
          Proxy type
          <select
            disabled={!hydrated}
            className="ui-select"
            value={draftType}
            onChange={(event) => setDraftType(event.target.value)}
          >
            <option value="">All types</option>
            <option value="residential">Residential</option>
            <option value="mobile">Mobile</option>
            <option value="datacenter">Datacenter</option>
          </select>
        </label>
        <label className="ui-field">
          Sort by
          <select
            disabled={!hydrated}
            className="ui-select"
            value={draftSort}
            onChange={(event) => setDraftSort(event.target.value)}
          >
            <option value="newest">Newest</option>
            <option value="price_asc">Lowest price</option>
            <option value="price_desc">Highest price</option>
            <option value="latency">Reported latency</option>
            <option value="sales">Order volume</option>
          </select>
        </label>
        <button
          disabled={!hydrated}
          className="ui-button secondary"
          type="button"
          onClick={() => setMoreOpen(true)}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          More filters{draftPrice && <span className="filter-count">1</span>}
        </button>
        <button className="ui-button" type="submit" disabled={!hydrated}>
          Apply filters
        </button>
      </form>
      <Modal
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title="Refine your results"
      >
        <form
          className="ui-page"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <label className="ui-field">
            Maximum USD / GB
            <input
              disabled={!hydrated}
              className="ui-input"
              data-testid="marketplace-filter-max-price"
              type="number"
              min="0"
              step="0.0001"
              value={draftPrice}
              onChange={(event) => setDraftPrice(event.target.value)}
              placeholder="No maximum"
            />
          </label>
          <p className="ui-note">
            Prices are listed in USD. Checkout confirms the required SOL escrow
            amount before a wallet signature.
          </p>
          <button type="submit" className="ui-button" disabled={!hydrated}>
            Apply filters
          </button>
        </form>
      </Modal>
    </section>
  );
}
