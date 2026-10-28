"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Bookmark,
  Check,
  MapPin,
  SlidersHorizontal,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
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
import { displayListingTitle } from "@/lib/listing-display";
import { Modal } from "@/components/patterns/Modal";
import { BuyListingModal } from "@/components/BuyListingModal";
import {
  PageHeading,
  Status,
  Loading,
  DataError,
  EmptyState,
  amount,
  countryName,
} from "@/components/workspace/Patterns";

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
  const [draftCountry, setDraftCountry] = useState(country);
  const [draftType, setDraftType] = useState(proxyType);
  const [draftPrice, setDraftPrice] = useState(maxPrice);
  const [draftSort, setDraftSort] = useState(sort);
  const [details, setDetails] = useState<Listing | null>(null);
  const [checkout, setCheckout] = useState<Listing | null>(null);
  const [compare, setCompare] = useState<Listing[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
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
  function apply() {
    update({
      country: draftCountry.trim().toUpperCase(),
      type: draftType,
      max_price: draftPrice,
      sort: draftSort,
    });
    setMoreOpen(false);
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
              {facets.data?.countries.map((item) => (
                <option key={item.value} value={item.value}>
                  {countryName(item.value)}
                </option>
              ))}
            </datalist>
          </label>
          <label className="ui-field">
            Proxy type
            <select
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
            className="ui-button secondary"
            type="button"
            onClick={() => setMoreOpen(true)}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            More filters
          </button>
          <button className="ui-button" type="submit">
            Apply filters
          </button>
        </form>
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
              : query.isError ? "Inventory unavailable" : "Loading inventory…"}
            {country ? ` · ${countryName(country)}` : ""}
            {maxPrice ? ` · up to $${maxPrice} / GB` : ""}
            {(country || proxyType || maxPrice) && (
              <button
                className="ui-button ghost small ml-4"
                onClick={() => {
                  setDraftCountry("");
                  setDraftType("");
                  setDraftPrice("");
                  update({ country: "", type: "", max_price: "" });
                }}
              >
                Clear filters
              </button>
            )}
          </p>
          {compare.length > 0 && (
            <div className="ui-surface ui-actions">
              <span className="ui-note">
                {compare.length} selected · compare up to three offers
              </span>
              <button
                className="ui-button small secondary"
                disabled={compare.length < 2}
                onClick={() => setCompareOpen(true)}
              >
                Compare offers
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
          <section aria-label="Proxy offers">
            {rows.map((listing) => (
              <article
                className="ui-listing"
                key={listing.id}
                data-testid={`listing-${listing.id}`}
              >
                <div>
                  <div className="ui-row-identity">
                    <span className="ui-region">{listing.country || "—"}</span>
                    <div>
                      <h2>{displayListingTitle(listing)}</h2>
                      <CatalogProductBadge product={listing.catalog_product} />
                      <p className="ui-note">
                        {countryName(listing.country)}
                        {listing.city ? ` · ${listing.city}` : ""} ·{" "}
                        {listing.proxy_type} ·{" "}
                        {listing.protocol || "Protocol not specified"}
                      </p>
                    </div>
                  </div>
                  <div className="ui-listing-meta">
                    <Status
                      tone={listing.status === "active" ? "good" : "neutral"}
                    >
                      {listing.status === "active"
                        ? "Listed"
                        : listing.status.replace(/_/g, " ")}
                    </Status>
                    <span>
                      {listing.avg_latency_ms > 0
                        ? `${amount(listing.avg_latency_ms)} ms · ${["gateway", "explorer"].includes(listing.sla_source || "") ? "measured" : "reported"}`
                        : "Latency not measured"}
                    </span>
                    <span>
                      {(listing.seller?.reviews_count ?? 0) > 0 &&
                      (listing.seller?.avg_rating ?? 0) > 0
                        ? `${amount(listing.seller?.avg_rating, 1)} · ${listing.seller?.reviews_count} reviews`
                        : "No reviews yet"}
                    </span>
                    {listing.listing_offer_verified && (
                      <span className="ui-inline-icon">
                        <Check size={13} />
                        Provider-signed offer
                      </span>
                    )}
                  </div>
                  <div className="ui-actions mt-3">
                    <button
                      className="ui-listing-save"
                      disabled={saving.isPending}
                      aria-label={
                        savedIds.has(listing.id) ? "Unsave offer" : "Save offer"
                      }
                      onClick={() => {
                        if (!isAuthenticated) {
                          router.push(
                            `/login?next=${encodeURIComponent("/marketplace")}`,
                          );
                          return;
                        }
                        saving.mutate({
                          id: listing.id,
                          remove: savedIds.has(listing.id),
                        });
                      }}
                    >
                      <Bookmark
                        size={12}
                        className="inline mr-1"
                        aria-hidden="true"
                      />
                      {savedIds.has(listing.id) ? "Saved" : "Save offer"}
                    </button>
                    <button
                      className="ui-listing-save"
                      onClick={() => toggleCompare(listing)}
                      aria-pressed={compare.some(
                        (item) => item.id === listing.id,
                      )}
                    >
                      {compare.some((item) => item.id === listing.id)
                        ? "Selected"
                        : "Compare"}
                    </button>
                  </div>
                </div>
                <div className="ui-listing-price">
                  <strong>${amount(listing.price_per_gb, 4)}</strong>
                  <span className="ui-note"> / GB</span>
                  <p>{amount(listing.min_purchase_gb)} GB minimum</p>
                  <button
                    className="ui-button small secondary"
                    onClick={() => setDetails(listing)}
                  >
                    View details <ArrowRight size={13} aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
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
          <button type="submit" className="ui-button">
            Apply filters
          </button>
        </form>
      </Modal>
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
                  <td>{displayListingTitle(item)}</td>
                  <td>${amount(item.price_per_gb, 4)}</td>
                  <td>
                    {item.avg_latency_ms > 0
                      ? `${amount(item.avg_latency_ms)} ms · reported`
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
