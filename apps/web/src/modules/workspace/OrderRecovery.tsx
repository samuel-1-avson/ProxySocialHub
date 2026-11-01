"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "@/lib/api/client";
import {
  confirmEscrowPayment,
  getListing,
  marketplaceKeys,
  type Order,
} from "@/lib/api/marketplace";
import { LazyBuyListingModal as BuyListingModal } from "@/components/marketplace/LazyBuyListingModal";
import { Modal } from "@/components/patterns/Modal";
import { DataError } from "@/components/workspace/Patterns";

export function OrderRecovery({ order }: { order: Order }) {
  const client = useQueryClient();
  const [resume, setResume] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const listing = useQuery({
    queryKey: marketplaceKeys.listing(order.listing_id),
    queryFn: () => getListing(order.listing_id),
    enabled: resume,
    staleTime: 15_000,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: marketplaceKeys.orders() });
    void client.invalidateQueries({
      queryKey: marketplaceKeys.order(order.id),
    });
    void client.invalidateQueries({
      queryKey: marketplaceKeys.orderCredentials(order.id),
    });
  };
  const check = useMutation({
    retry: false,
    mutationFn: () => confirmEscrowPayment(order.id),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    retry: false,
    mutationFn: () =>
      apiPost(`/v1/orders/${encodeURIComponent(order.id)}/cancel`, {}),
    onSuccess: () => {
      setCancelOpen(false);
      refresh();
    },
  });
  return (
    <section className="ui-attention ui-page">
      <div>
        <h3>Continue this existing order</h3>
        <p>
          If a wallet transfer already completed, check its escrow before
          attempting another payment. Payment verification does not send funds.
        </p>
      </div>
      <div className="ui-actions">
        <button
          className="ui-button secondary"
          disabled={check.isPending || cancel.isPending}
          onClick={() => check.mutate()}
        >
          {check.isPending ? "Checking escrow…" : "Check existing payment"}
        </button>
        <button
          className="ui-button"
          disabled={check.isPending || cancel.isPending}
          onClick={() => setResume(true)}
        >
          Resume payment
        </button>
        <button
          className="ui-button ghost"
          onClick={() => {
            cancel.reset();
            setCancelOpen(true);
          }}
        >
          Cancel unfunded order…
        </button>
      </div>
      {check.isError && <DataError error={check.error} />}
      {check.isSuccess && (
        <p className="ui-note" role="status">
          Escrow verification returned. Refreshing this order’s access state.
        </p>
      )}
      {resume && listing.isLoading && (
        <p role="status" className="ui-note">
          Loading the original offer…
        </p>
      )}
      {resume && listing.isError && (
        <DataError error={listing.error} retry={() => void listing.refetch()} />
      )}
      {resume && listing.data && (
        <BuyListingModal
          key={order.id}
          listing={listing.data.listing}
          existingOrder={order}
          surface="order-recovery"
          onClose={() => setResume(false)}
          onSuccess={() => {
            setResume(false);
            refresh();
          }}
        />
      )}
      <Modal
        open={cancelOpen}
        onOpenChange={(open) => {
          if (!cancel.isPending) setCancelOpen(open);
        }}
        title="Cancel this unfunded order?"
        description="The server rejects cancellation if the order already has escrow funding."
      >
        <p className="ui-note">
          This cancels an unfunded pending order. It does not refund escrow or
          settle an active session.
        </p>
        {cancel.isError && <DataError error={cancel.error} />}
        <div className="ui-actions mt-4">
          <button
            className="ui-button secondary"
            disabled={cancel.isPending}
            onClick={() => setCancelOpen(false)}
          >
            Keep order
          </button>
          <button
            className="ui-button"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Cancel unfunded order
          </button>
        </div>
      </Modal>
    </section>
  );
}
