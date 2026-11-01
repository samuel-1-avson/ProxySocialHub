"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  Gauge,
  Globe2,
  Layers,
  Share2,
  ShieldCheck,
  ShoppingCart,
  Star,
} from "lucide-react";
import {
  getListing,
  saveListing,
  unsaveListing,
  marketplaceKeys,
} from "@/lib/api/marketplace";
import { useAuth } from "@/lib/auth";
import { LazyBuyListingModal as BuyListingModal } from "@/components/marketplace/LazyBuyListingModal";
import { ListingSocialPanel } from "@/components/marketplace/ListingSocialPanel";
import { ListingQASection } from "@/components/marketplace/ListingQASection";
import { CatalogProductBadge } from "@/components/marketplace/CatalogProductBadge";
import { trackListingViewOnce } from "@/lib/analytics/marketplace-funnel";
import {
  displayListingTitle,
  listingShowsCatalogSubtitle,
} from "@/lib/listing-display";
import {
  PageHeading,
  Stat,
  Status,
  Loading,
  DataError,
  amount,
  countryName,
} from "@/components/workspace/Patterns";

function ListingDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const client = useQueryClient();
  const [buyOpen, setBuyOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [shareError, setShareError] = useState("");
  const key = [...marketplaceKeys.listing(id), user?.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => getListing(id),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
  const listing = query.data?.listing;
  const saved = query.data?.is_saved ?? false;
  useEffect(() => {
    if (listing) trackListingViewOnce(listing.id, "detail", Boolean(user));
  }, [listing, user]);
  const save = useMutation({
    mutationFn: () => (saved ? unsaveListing(id) : saveListing(id)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: marketplaceKeys.all });
    },
  });
  function requireLogin() {
    router.push("/login?next=" + encodeURIComponent("/marketplace/" + id));
  }
  async function shareListing() {
    setShareError("");
    try {
      await navigator.clipboard.writeText(
        window.location.origin + "/marketplace/" + encodeURIComponent(id),
      );
      setShared(true);
    } catch {
      setShareError(
        "Clipboard access is unavailable. Copy this page’s address from your browser.",
      );
    }
  }
  if (query.isLoading) return <Loading label="Loading listing details…" />;
  if (query.isError || !listing)
    return (
      <div className="ui-page">
        <Link className="ui-button ghost self-start" href="/marketplace">
          <ArrowLeft size={15} aria-hidden="true" />
          Marketplace
        </Link>
        <PageHeading
          eyebrow="Marketplace"
          title="Listing unavailable"
          description="This offer could not be loaded. You can retry or choose another offer."
        />
        <DataError error={query.error} retry={() => void query.refetch()} />
      </div>
    );
  const purchasable =
    listing.status === "active" && listing.available_bandwidth_gb > 0;
  const measured = ["gateway", "explorer"].includes(listing.sla_source || "");
  const provenance = measured
    ? "Measured · " + listing.sla_source
    : listing.sla_source
      ? "Reported · " + listing.sla_source
      : "No source reported";
  const hasReviews =
    (listing.seller?.reviews_count ?? 0) > 0 &&
    (listing.seller?.avg_rating ?? 0) > 0;
  return (
    <div className="ui-page listing-detail">
      <Link className="ui-button ghost self-start" href="/marketplace">
        <ArrowLeft size={15} aria-hidden="true" />
        Back to marketplace
      </Link>
      <PageHeading
        eyebrow="Marketplace / offer details"
        title={displayListingTitle(listing)}
        description={
          countryName(listing.country) +
          (listing.city ? " · " + listing.city : "") +
          " · " +
          listing.proxy_type +
          " capacity"
        }
        actions={
          <>
            <button
              className="ui-button secondary"
              aria-label={saved ? "Remove from saved" : "Save listing"}
              aria-pressed={saved}
              disabled={
                save.isPending || (!saved && listing.status !== "active")
              }
              onClick={() => (user ? save.mutate() : requireLogin())}
            >
              <Bookmark
                size={15}
                fill={saved ? "currentColor" : "none"}
                aria-hidden="true"
              />
              {save.isPending ? "Saving…" : saved ? "Saved" : "Save offer"}
            </button>
            <button
              className="ui-button secondary"
              aria-label="Share listing"
              onClick={() => void shareListing()}
            >
              {shared ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <Share2 size={15} aria-hidden="true" />
              )}
              {shared ? "Link copied" : "Share"}
            </button>
          </>
        }
      />
      {save.isError && (
        <DataError
          title="The saved offer could not be updated"
          error={save.error}
        />
      )}
      {shareError && (
        <p className="ui-error" role="alert">
          {shareError}
        </p>
      )}
      {shared && (
        <span className="sr-only" role="status">
          Listing link copied to clipboard.
        </span>
      )}
      <div className="detail-columns">
        <div className="detail-main">
          <section className="ui-surface listing-intro">
            <div className="ui-section-heading">
              <div className="ui-actions">
                <span className="offer-region">
                  {listing.country || <Globe2 size={19} aria-hidden="true" />}
                </span>
                <Status tone={listing.status === "active" ? "good" : "neutral"}>
                  {listing.status.replace(/_/g, " ")}
                </Status>
                <CatalogProductBadge product={listing.catalog_product} />
              </div>
              <span className="detail-review">
                <Star size={14} aria-hidden="true" />
                {hasReviews
                  ? amount(listing.seller?.avg_rating, 1) +
                    " · " +
                    listing.seller?.reviews_count +
                    " reviews"
                  : "No reviews yet"}
              </span>
            </div>
            {listingShowsCatalogSubtitle(listing) && (
              <h2 className="listing-subtitle">{listing.title}</h2>
            )}
            <p className="listing-description">
              {listing.description ||
                "The provider has not added a description for this offer."}
            </p>
            <dl className="detail-spec-grid">
              <div>
                <dt>Proxy type</dt>
                <dd>{listing.proxy_type}</dd>
              </div>
              <div>
                <dt>Protocol</dt>
                <dd>{listing.protocol || "Not specified"}</dd>
              </div>
              <div>
                <dt>Concurrency limit</dt>
                <dd>
                  {listing.max_concurrency > 0
                    ? amount(listing.max_concurrency, 0) + " connections"
                    : "Not reported"}
                </dd>
              </div>
              <div>
                <dt>Active sessions</dt>
                <dd>{amount(listing.active_sessions_count, 0)}</dd>
              </div>
            </dl>
          </section>
          <section>
            <div className="ui-section-heading">
              <div>
                <p className="ui-eyebrow">Network evidence</p>
                <h2>Performance & availability</h2>
              </div>
              <span className="ui-tag">
                {measured ? "Measured metrics" : "Reported metrics"}
              </span>
            </div>
            <div className="ui-stats">
              <Stat
                icon={<Gauge size={18} />}
                label="Latency"
                value={
                  listing.avg_latency_ms > 0
                    ? amount(listing.avg_latency_ms) + " ms"
                    : "Not measured"
                }
                detail={provenance}
              />
              <Stat
                icon={<Layers size={18} />}
                label="Available capacity"
                value={amount(listing.available_bandwidth_gb) + " GB"}
                detail="Published by the provider"
              />
              <Stat
                icon={<ShieldCheck size={18} />}
                label="Uptime"
                value={
                  listing.sla_source && Number.isFinite(listing.uptime_percent)
                    ? amount(listing.uptime_percent, 2) + "%"
                    : "—"
                }
                detail={provenance}
              />
            </div>
          </section>
          <section className="detail-evidence ui-surface">
            <ShieldCheck size={23} aria-hidden="true" />
            <div>
              <h2>
                {listing.listing_offer_verified
                  ? "Provider signature verified"
                  : "Offer signature not verified"}
              </h2>
              <p>
                {listing.listing_offer_verified
                  ? "The marketplace verified the provider’s offer signature. Availability, node health, and client routing are separate signals."
                  : "A verified provider signature has not been reported for this offer. Review the terms and available evidence before checkout."}
              </p>
            </div>
          </section>
          <ListingQASection listingId={listing.id} />
        </div>
        <aside className="detail-sidebar" aria-label="Purchase and provider">
          <section className="purchase-summary">
            <p className="ui-eyebrow">Published price / USD</p>
            <div className="purchase-price">
              <strong>
                {"$"}
                {amount(listing.price_per_gb, 4)}
              </strong>
              <span>per GB</span>
            </div>
            <dl className="ui-detail-list">
              <div>
                <dt>Minimum purchase</dt>
                <dd>
                  {Number.isFinite(listing.min_purchase_gb)
                    ? listing.min_purchase_gb === 0
                      ? "No minimum"
                      : amount(listing.min_purchase_gb) + " GB"
                    : "Not reported"}
                </dd>
              </div>
              <div>
                <dt>Available bandwidth</dt>
                <dd>{amount(listing.available_bandwidth_gb)} GB</dd>
              </div>
              <div>
                <dt>Listing state</dt>
                <dd>{listing.status.replace(/_/g, " ")}</dd>
              </div>
            </dl>
            <button
              className="ui-button purchase-action"
              disabled={!purchasable}
              onClick={() => (user ? setBuyOpen(true) : requireLogin())}
            >
              <ShoppingCart size={17} aria-hidden="true" />
              {purchasable ? "Buy bandwidth" : "Currently unavailable"}
              <ArrowRight size={14} aria-hidden="true" />
            </button>
            <p className="ui-note">
              Review the exact bandwidth and required SOL escrow amount before
              signing a wallet transaction.
            </p>
            {listing.seller && (
              <div className="purchase-provider">
                <span>Provided by</span>
                <Link
                  href={
                    "/profile/" +
                    encodeURIComponent(
                      listing.seller.username || listing.seller.id,
                    )
                  }
                >
                  {listing.seller.display_name ||
                    listing.seller.username ||
                    "View provider"}
                </Link>
              </div>
            )}
          </section>
          <ListingSocialPanel
            listingId={listing.id}
            listingTitle={displayListingTitle(listing)}
            pricePerGb={listing.price_per_gb}
            location={listing.seller?.location}
          />
        </aside>
      </div>
      {buyOpen && (
        <BuyListingModal
          listing={listing}
          surface="detail"
          onClose={() => setBuyOpen(false)}
          onSuccess={(orderId) => {
            void client.invalidateQueries({ queryKey: marketplaceKeys.all });
            router.push("/app/connections/" + encodeURIComponent(orderId));
          }}
        />
      )}
    </div>
  );
}

export default function ListingDetailPage() {
  return (
    <Suspense fallback={<Loading label="Loading listing…" />}>
      <ListingDetailContent />
    </Suspense>
  );
}
