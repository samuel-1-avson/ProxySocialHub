"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  deleteListing,
  getMyListings,
  marketplaceKeys,
  updateListing,
  type Listing,
} from "@/lib/api/marketplace";
import { displayListingTitle } from "@/lib/listing-display";
import { evaluateListingPrice } from "@/lib/listing-price";
import { CatalogProductBadge } from "@/components/marketplace/CatalogProductBadge";
import { Modal } from "@/components/patterns/Modal";
import {
  PageHeading,
  Loading,
  DataError,
  EmptyState,
  Status,
  amount,
  countryName,
} from "@/components/workspace/Patterns";

export function SellerListings() {
  const { user } = useAuth();
  const client = useQueryClient();
  const params = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const query = useQuery({
    queryKey: [...marketplaceKeys.myListings(page), user?.id],
    queryFn: () => getMyListings(page, 20),
    staleTime: 15_000,
  });
  const [editing, setEditing] = useState<Listing | null>(null);
  const [removing, setRemoving] = useState<Listing | null>(null);
  const [notice, setNotice] = useState("");
  const invalidate = () =>
    client.invalidateQueries({ queryKey: marketplaceKeys.all });
  const status = useMutation({
    retry: false,
    mutationFn: ({ id, state }: { id: string; state: "active" | "paused" }) =>
      updateListing(id, { status: state }),
    onSuccess: () => {
      setNotice("Offer status updated.");
      void invalidate();
    },
  });
  const remove = useMutation({
    retry: false,
    mutationFn: (id: string) => deleteListing(id),
    onSuccess: () => {
      setRemoving(null);
      setNotice(
        "Listing removed. Existing orders remain in their order history.",
      );
      void invalidate();
    },
  });
  const pending = params.get("submitted") === "pending_review";
  return (
    <div className="ui-page">
      <PageHeading
        eyebrow="Seller workspace"
        title="Listings"
        description="Manage pricing, capacity, publication, and catalog context in one place."
        actions={
          <Link className="ui-button" href="/provider/listings/new">
            Create listing
          </Link>
        }
      />
      <nav className="ui-tabs" aria-label="Seller listing views">
        <Link className="active" aria-current="page" href="/provider/listings">
          Offers
        </Link>
        <Link href="/marketplace/manage/products">Products</Link>
      </nav>
      {pending && (
        <div className="ui-attention" role="status">
          <h3>Your offer is awaiting review.</h3>
          <p>
            It becomes purchasable only after the server approves publication.
            Avoid submitting the same offer again.
          </p>
        </div>
      )}
      {notice && (
        <p className="ui-note" role="status">
          {notice}
        </p>
      )}
      {query.isLoading && <Loading label="Loading your listings…" />}
      {query.isError && (
        <DataError error={query.error} retry={() => void query.refetch()} />
      )}
      {status.isError && <DataError error={status.error} />}
      {query.isSuccess && !query.data.listings.length && (
        <EmptyState
          title="Publish capacity from a healthy node."
          description="Set a price, available bandwidth, and purchase minimum, then review the offer before publishing."
          href="/provider/listings/new"
          action="Create a listing"
        />
      )}
      {query.data?.listings.map((listing) => (
        <section className="ui-listing" key={listing.id}>
          <div>
            <h2>{displayListingTitle(listing)}</h2>
            <CatalogProductBadge product={listing.catalog_product} />
            <p className="ui-note">
              {countryName(listing.country)} · {listing.proxy_type} ·{" "}
              {listing.protocol}
            </p>
            <div className="ui-listing-meta">
              <Status
                tone={
                  listing.status === "active"
                    ? "good"
                    : listing.status === "pending_review"
                      ? "warning"
                      : "neutral"
                }
              >
                {listing.status.replace(/_/g, " ")}
              </Status>
              <span>
                {amount(listing.available_bandwidth_gb)} GB reported capacity
              </span>
              <span>{amount(listing.orders_count, 0)} orders</span>
            </div>
            <div className="ui-actions mt-4">
              <button
                className="ui-button secondary small"
                onClick={() => setEditing(listing)}
              >
                Edit offer
              </button>
              {["active", "paused"].includes(listing.status) && (
                <button
                  className="ui-button secondary small"
                  disabled={status.isPending}
                  onClick={() =>
                    status.mutate({
                      id: listing.id,
                      state: listing.status === "active" ? "paused" : "active",
                    })
                  }
                >
                  {listing.status === "active" ? "Pause offer" : "Resume offer"}
                </button>
              )}
              <button
                className="ui-button ghost small"
                onClick={() => {
                  remove.reset();
                  setRemoving(listing);
                }}
              >
                Remove…
              </button>
            </div>
          </div>
          <div className="ui-listing-price">
            <strong>${amount(listing.price_per_gb, 4)}</strong>
            <span className="ui-note"> / GB</span>
            <p>{amount(listing.min_purchase_gb)} GB minimum</p>
            <Link
              className="ui-button secondary small"
              href={`/marketplace/${encodeURIComponent(listing.id)}`}
            >
              Preview listing →
            </Link>
          </div>
        </section>
      ))}
      {(query.data?.total ?? 0) > 20 && (
        <nav className="ui-pagination" aria-label="Listing pagination">
          {page > 1 ? (
            <Link
              className="ui-button secondary small"
              href={`/provider/listings?page=${page - 1}`}
            >
              Previous
            </Link>
          ) : (
            <span>First page</span>
          )}
          <span>
            Page {page} of {Math.ceil((query.data?.total ?? 0) / 20)}
          </span>
          {page * 20 < (query.data?.total ?? 0) && (
            <Link
              className="ui-button secondary small"
              href={`/provider/listings?page=${page + 1}`}
            >
              Next
            </Link>
          )}
        </nav>
      )}
      <Modal
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title="Edit offer"
        description="Changes are checked by the marketplace before they are applied."
      >
        {editing && (
          <EditOffer
            key={editing.id}
            listing={editing}
            onSaved={() => {
              setEditing(null);
              setNotice("Offer saved. Review its publication state below.");
              void invalidate();
            }}
          />
        )}
      </Modal>
      <Modal
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemoving(null);
        }}
        title={`Remove ${removing ? displayListingTitle(removing) : "listing"}?`}
        description="This removes the offer from the marketplace."
      >
        <p className="ui-note">
          Existing orders, access, and settlement records remain separate. Pause
          the offer if you intend to sell this capacity again.
        </p>
        {remove.isError && <DataError error={remove.error} />}
        <div className="ui-actions mt-4">
          <button
            className="ui-button secondary"
            disabled={remove.isPending}
            onClick={() => setRemoving(null)}
          >
            Keep listing
          </button>
          <button
            className="ui-button"
            disabled={remove.isPending}
            onClick={() => {
              if (removing) remove.mutate(removing.id);
            }}
          >
            {remove.isPending ? "Removing…" : "Remove listing"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function EditOffer({
  listing,
  onSaved,
}: {
  listing: Listing;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description ?? "");
  const [price, setPrice] = useState(String(listing.price_per_gb));
  const [capacity, setCapacity] = useState(
    String(listing.available_bandwidth_gb),
  );
  const [minimum, setMinimum] = useState(String(listing.min_purchase_gb));
  const [concurrency, setConcurrency] = useState(
    String(listing.max_concurrency),
  );
  const guidance = evaluateListingPrice(Number(price), listing.proxy_type);
  const valid =
    title.trim() &&
    Number(price) > 0 &&
    Number(capacity) >= 0 &&
    Number(minimum) > 0 &&
    Number.isInteger(Number(concurrency)) &&
    Number(concurrency) > 0 &&
    !guidance.overHardCap;
  const save = useMutation({
    retry: false,
    mutationFn: () =>
      updateListing(listing.id, {
        title: title.trim(),
        description: description.trim(),
        price_per_gb: Number(price),
        available_bandwidth_gb: Number(capacity),
        min_purchase_gb: Number(minimum),
        max_concurrency: Number(concurrency),
      }),
    onSuccess: onSaved,
  });
  return (
    <form
      className="ui-page"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <fieldset className="ui-page" disabled={save.isPending}>
        <label className="ui-field">
          Offer title
          <input
            className="ui-input"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="ui-field">
          Description
          <textarea
            className="ui-input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="ui-form-grid">
          <label className="ui-field">
            USD per GB
            <input
              className="ui-input"
              type="number"
              required
              min="0.0001"
              max="50"
              step="0.0001"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <label className="ui-field">
            Available bandwidth (GB)
            <input
              className="ui-input"
              type="number"
              required
              min="0"
              step="0.01"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </label>
          <label className="ui-field">
            Minimum purchase (GB)
            <input
              className="ui-input"
              type="number"
              required
              min="0.01"
              step="0.01"
              value={minimum}
              onChange={(e) => setMinimum(e.target.value)}
            />
          </label>
          <label className="ui-field">
            Concurrent connections
            <input
              className="ui-input"
              type="number"
              required
              min="1"
              step="1"
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
            />
          </label>
        </div>
      </fieldset>
      {guidance.overHardCap && (
        <p role="alert" className="ui-note">
          Price exceeds the $50 / GB limit.
        </p>
      )}
      {guidance.overSoftCap && !guidance.overHardCap && (
        <p className="ui-note">
          This price is above the default guidance. The server may place the
          offer into review.
        </p>
      )}
      {save.isError && <DataError error={save.error} />}
      <button className="ui-button" disabled={!valid || save.isPending}>
        {save.isPending ? "Saving…" : "Save offer"}
      </button>
    </form>
  );
}
