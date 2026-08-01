"use client";

import { useAuth } from "@/lib/auth";
import {
  cancelOrder,
  getOrders,
  marketplaceKeys,
  orderCancelEligible,
  orderCredentialsEligible,
  orderStatusLabel,
  type Order,
} from "@/lib/api/marketplace";
import { getErrorMessage } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ROUTES } from "@/lib/navigation/routes";
import { useMemo, useState } from "react";
import { ArrowLeft, Package } from "lucide-react";
import { formatListingTotalUSD } from "@/lib/listing-price";
import { type ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/patterns/DataTable";
import { ConfirmDialog } from "@/components/patterns/ConfirmDialog";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";

function orderTotal(order: Order) {
  return order.total_price ?? order.price_total ?? 0;
}

function statusVariant(status: string): "pending" | "online" | "error" | "paused" | "verified" {
  const s = status.toLowerCase();
  if (s.includes("active") || s.includes("complete") || s.includes("fulfilled")) return "online";
  if (s.includes("cancel") || s.includes("fail")) return "error";
  if (s.includes("pending") || s.includes("escrow")) return "pending";
  return "paused";
}

export default function MarketplaceOrdersPage() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: marketplaceKeys.orders("all"),
    queryFn: () => getOrders(),
    enabled: isAuthenticated,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
      setCancelTarget(null);
    },
  });

  const orders = data ?? [];

  const columns = useMemo<ColumnDef<Order, unknown>[]>(
    () => [
      {
        accessorKey: "id",
        header: "Order",
        meta: { priority: 1, mono: true },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {row.original.listing?.title ?? "Marketplace order"}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {row.original.id.slice(0, 8)}…
            </p>
          </div>
        ),
      },
      {
        id: "bandwidth",
        header: "Bandwidth",
        meta: { priority: 2, mono: true, align: "right" },
        cell: ({ row }) => `${row.original.bandwidth_gb} GB`,
      },
      {
        id: "total",
        header: "Total",
        meta: { priority: 1, mono: true, align: "right" },
        cell: ({ row }) => formatListingTotalUSD(orderTotal(row.original)),
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { priority: 1 },
        cell: ({ row }) => (
          <StatusBadge
            status={statusVariant(row.original.status)}
            label={orderStatusLabel(row.original.status)}
          />
        ),
      },
      {
        id: "actions",
        header: "Actions",
        meta: { priority: 1, align: "right" },
        enableSorting: false,
        cell: ({ row }) => {
          const order = row.original;
          return (
            <div className="flex flex-wrap justify-end gap-2">
              {orderCancelEligible(order.status) ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCancelTarget(order)}
                >
                  Cancel
                </Button>
              ) : null}
              <Link
                href={ROUTES.marketplaceOrder(order.id)}
                className="inline-flex h-8 items-center rounded-[var(--radius-md)] border border-border bg-secondary px-3 text-xs font-medium hover:bg-[var(--secondary-light)]"
                data-testid={`order-credentials-link-${order.id}`}
              >
                {orderCredentialsEligible(order.status) ? "Credentials" : "View"}
              </Link>
            </div>
          );
        },
      },
    ],
    []
  );

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="mb-4 text-muted-foreground">Sign in to view your marketplace orders.</p>
        <Link href="/login" className="text-sm font-medium text-primary hover:underline">
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <div>
        <Link
          href={ROUTES.marketplace}
          className="mb-3 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={12} aria-hidden /> Discover
        </Link>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary">
          <Package size={14} aria-hidden />
          Buyer
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track purchases, escrow status, and linked sessions.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={orders}
        loading={isLoading}
        error={error ? getErrorMessage(error) : null}
        onRetry={() => void refetch()}
        emptyTitle="No orders yet"
        emptyDescription="Browse the marketplace to purchase proxy access."
        emptyActionLabel="Browse marketplace"
        onEmptyAction={() => {
          window.location.href = ROUTES.marketplace;
        }}
        getRowId={(row) => row.id}
        renderMobileCard={(order) => (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{order.listing?.title ?? "Marketplace order"}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {order.bandwidth_gb} GB · {formatListingTotalUSD(orderTotal(order))}
                </p>
              </div>
              <StatusBadge
                status={statusVariant(order.status)}
                label={orderStatusLabel(order.status)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {orderCancelEligible(order.status) ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setCancelTarget(order)}>
                  Cancel
                </Button>
              ) : null}
              <Link
                href={ROUTES.marketplaceOrder(order.id)}
                className="inline-flex h-8 items-center rounded-[var(--radius-md)] border border-border px-3 text-xs font-medium hover:bg-secondary"
                data-testid={`order-credentials-link-${order.id}`}
              >
                {orderCredentialsEligible(order.status) ? "Credentials" : "View"}
              </Link>
            </div>
          </div>
        )}
      />

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        title="Cancel order"
        description={
          cancelTarget
            ? `Cancel “${cancelTarget.listing?.title ?? "this order"}”? Escrow may be refunded per order terms.`
            : undefined
        }
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        destructive
        loading={cancelMutation.isPending}
        error={cancelMutation.error ? getErrorMessage(cancelMutation.error) : undefined}
        onConfirm={() => {
          if (cancelTarget) cancelMutation.mutate(cancelTarget.id);
        }}
      />
    </div>
  );
}
