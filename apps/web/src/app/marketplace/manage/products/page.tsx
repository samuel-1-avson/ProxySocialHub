"use client";

import { DataError } from "@/components/workspace/Patterns";
import { Modal } from "@/components/patterns/Modal";
import { useAuth } from "@/lib/auth";
import {
  catalogKeys,
  createCatalogProduct,
  getCatalogProduct,
  getMyCatalogProducts,
  linkCatalogOffer,
  unlinkCatalogOffer,
  updateCatalogProduct,
  type CatalogProduct,
  type CatalogProductStatus,
  type CatalogProductView,
} from "@/lib/api/catalog";
import {
  getMyListings,
  marketplaceKeys,
  type Listing,
} from "@/lib/api/marketplace";
import { displayListingTitle } from "@/lib/listing-display";
import { getErrorMessage } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Link2,
  Loader2,
  Package,
  Pencil,
  Plus,
  Unlink,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { SellerManageTabs } from "@/components/marketplace/SellerManageTabs";
import { ROUTES } from "@/lib/navigation/routes";

type ProductForm = {
  title: string;
  description: string;
  slug: string;
  status: CatalogProductStatus;
};

const emptyForm = (): ProductForm => ({
  title: "",
  description: "",
  slug: "",
  status: "draft",
});

export default function ManageCatalogProductsPage() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const limit = 20;
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<ProductForm>(emptyForm);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ProductForm>(emptyForm);
  const [linkListingId, setLinkListingId] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: catalogKeys.myProducts(page),
    queryFn: () => getMyCatalogProducts(page, limit),
    enabled: isAuthenticated,
  });

  const {
    data: productView,
    isLoading: productLoading,
    error: productError,
    refetch: retryProduct,
  } = useQuery({
    queryKey: catalogKeys.product(managingId ?? ""),
    queryFn: () => getCatalogProduct(managingId!),
    enabled: Boolean(managingId),
  });

  const { data: myListingsData } = useQuery({
    queryKey: marketplaceKeys.myListings(1),
    queryFn: () => getMyListings(1, 100),
    enabled: isAuthenticated && Boolean(managingId),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      if (createForm.title.trim().length < 3)
        throw new Error("Enter a product title with at least 3 characters.");
      return createCatalogProduct({
        title: createForm.title.trim(),
        description: createForm.description.trim(),
        slug: createForm.slug.trim() || undefined,
        status: createForm.status,
      });
    },
    onSuccess: () => {
      setCreateOpen(false);
      setCreateForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) =>
      updateCatalogProduct(id, {
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        slug: editForm.slug.trim() || undefined,
        status: editForm.status,
      }),
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      void queryClient.invalidateQueries({ queryKey: catalogKeys.product(id) });
    },
  });

  const linkMutation = useMutation({
    mutationFn: (productId: string) =>
      linkCatalogOffer(productId, {
        listing_id: linkListingId,
        is_primary: true,
      }),
    onSuccess: (_, productId) => {
      setLinkListingId("");
      void queryClient.invalidateQueries({
        queryKey: catalogKeys.product(productId),
      });
      void queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: ({
      productId,
      offerId,
    }: {
      productId: string;
      offerId: string;
    }) => unlinkCatalogOffer(productId, offerId),
    onSuccess: (_, { productId }) => {
      void queryClient.invalidateQueries({
        queryKey: catalogKeys.product(productId),
      });
      void queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
    },
  });

  const linkedListingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const offer of productView?.offers ?? []) {
      ids.add(offer.listing_id);
    }
    return ids;
  }, [productView?.offers]);

  const linkableListings = useMemo(() => {
    return (myListingsData?.listings ?? []).filter(
      (l) => !linkedListingIds.has(l.id),
    );
  }, [myListingsData?.listings, linkedListingIds]);

  const openManage = (product: CatalogProduct) => {
    setManagingId(product.id);
    setEditForm({
      title: product.title,
      description: product.description ?? "",
      slug: product.slug,
      status: product.status,
    });
    setLinkListingId("");
  };

  const products = data?.products ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (!isAuthenticated) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-muted-foreground mb-4">
          Sign in to manage catalog products.
        </p>
        <Link
          href="/login"
          className="text-primary font-bold normal-case text-xs tracking-normal"
        >
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div
      className="record-family catalog-page max-w-6xl mx-auto py-4 space-y-8"
      data-testid="catalog-manage"
    >
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <Link
            href={ROUTES.marketplace}
            className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-primary normal-case tracking-normal mb-3"
          >
            ← Discover
          </Link>
          <div className="flex items-center gap-2 text-primary font-bold normal-case tracking-normal text-xs mb-2">
            <Package size={14} />
            Sell
          </div>
          <h1 className="text-3xl font-semibold tracking-tighter normal-case italic">
            My <span className="text-primary">Products</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Merchandising titles that group listings for browse cards and
            discovery.
          </p>
          <div className="mt-4">
            <SellerManageTabs />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={ROUTES.marketplaceMap}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-white/15 text-foreground hover:bg-white/5 rounded-xl text-xs font-semibold normal-case tracking-normal transition-colors"
          >
            Supply map
          </Link>
          <button
            type="button"
            onClick={() => {
              setCreateForm(emptyForm());
              setCreateOpen(true);
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl text-xs font-semibold normal-case tracking-normal transition-colors"
            data-testid="catalog-create-product"
          >
            <Plus size={14} /> New product
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="flex flex-col items-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-xs font-mono text-muted-foreground normal-case tracking-normal">
            Loading products…
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-sm text-red-400">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>
            {error instanceof Error
              ? error.message
              : "Failed to load catalog products"}
          </span>
        </div>
      )}

      {!isLoading && !error && products.length === 0 && (
        <div className="text-center py-16 border border-dashed border-border rounded-2xl">
          <p className="text-muted-foreground mb-4">No catalog products yet.</p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="text-primary font-bold normal-case text-xs tracking-normal"
          >
            Create your first product
          </button>
        </div>
      )}

      <ul className="space-y-3" data-testid="catalog-products-list">
        {products.map((product) => (
          <li
            key={product.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-white/[0.02]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-bold truncate">{product.title}</h2>
                <span className="text-xs font-semibold normal-case tracking-normal px-2 py-0.5 rounded-full bg-white/5 text-muted-foreground">
                  {product.status}
                </span>
              </div>
              <p className="text-xs font-mono text-primary/80 mt-1">
                /{product.slug}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openManage(product)}
              className="px-3 py-2 rounded-lg border border-violet-500/20 text-primary text-xs font-bold normal-case tracking-normal hover:bg-primary/90/10 inline-flex items-center gap-1 shrink-0"
              data-testid={`catalog-product-manage-${product.id}`}
            >
              <Pencil size={12} /> Manage
            </button>
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 text-xs font-bold normal-case tracking-normal rounded-lg border border-border disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-muted-foreground self-center">
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 text-xs font-bold normal-case tracking-normal rounded-lg border border-border disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {createOpen && (
        <ProductFormDialog
          title="New catalog product"
          form={createForm}
          onChange={setCreateForm}
          onClose={() => setCreateOpen(false)}
          onSubmit={() => createMutation.mutate()}
          submitting={createMutation.isPending}
          error={createMutation.error}
        />
      )}

      {managingId && (
        <ManageProductDialog
          view={productView}
          loadError={productError}
          retryLoad={() => void retryProduct()}
          loading={productLoading}
          form={editForm}
          onChange={setEditForm}
          linkListingId={linkListingId}
          onLinkListingIdChange={setLinkListingId}
          linkableListings={linkableListings}
          onClose={() => setManagingId(null)}
          onSave={() => updateMutation.mutate(managingId)}
          onLink={() => linkMutation.mutate(managingId)}
          onUnlink={(offerId) =>
            unlinkMutation.mutate({ productId: managingId, offerId })
          }
          saving={updateMutation.isPending}
          linking={linkMutation.isPending}
          unlinking={unlinkMutation.isPending}
          saveError={updateMutation.error}
          linkError={linkMutation.error || unlinkMutation.error}
        />
      )}
    </div>
  );
}

function ProductFormDialog({
  title,
  form,
  onChange,
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  title: string;
  form: ProductForm;
  onChange: (f: ProductForm) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: unknown;
}) {
  return (
    <DialogShell title={title} onClose={onClose}>
      <ProductFields form={form} onChange={onChange} />
      {error ? (
        <p className="text-sm text-red-400">{getErrorMessage(error)}</p>
      ) : null}
      <DialogActions
        onClose={onClose}
        onSubmit={onSubmit}
        submitting={submitting}
        submitLabel="Create"
      />
    </DialogShell>
  );
}

function ManageProductDialog({
  loadError,
  retryLoad,
  view,
  loading,
  form,
  onChange,
  linkListingId,
  onLinkListingIdChange,
  linkableListings,
  onClose,
  onSave,
  onLink,
  onUnlink,
  saving,
  linking,
  unlinking,
  saveError,
  linkError,
}: {
  view?: CatalogProductView;
  loadError: unknown;
  retryLoad: () => void;
  loading: boolean;
  form: ProductForm;
  onChange: (f: ProductForm) => void;
  linkListingId: string;
  onLinkListingIdChange: (id: string) => void;
  linkableListings: Listing[];
  onClose: () => void;
  onSave: () => void;
  onLink: () => void;
  onUnlink: (offerId: string) => void;
  saving: boolean;
  linking: boolean;
  unlinking: boolean;
  saveError: unknown;
  linkError: unknown;
}) {
  return (
    <DialogShell title="Manage product" onClose={onClose} wide>
      {loadError ? (
        <DataError
          title="Product details are unavailable"
          error={loadError}
          retry={retryLoad}
        />
      ) : loading && !view ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <ProductFields form={form} onChange={onChange} />
          {saveError ? (
            <p className="text-sm text-red-400">{getErrorMessage(saveError)}</p>
          ) : null}
          <div className="flex justify-end gap-2 pb-4 border-b border-border">
            <button
              type="button"
              disabled={saving}
              onClick={onSave}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold normal-case tracking-normal disabled:opacity-50"
            >
              Save product
            </button>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold normal-case tracking-normal text-muted-foreground flex items-center gap-2">
              <Link2 size={12} /> Linked listings
            </h3>
            {(view?.offers ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No listings linked yet.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="catalog-product-offers">
                {view?.offers.map((offer) => (
                  <li
                    key={offer.id}
                    className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border bg-muted/50"
                  >
                    <span className="text-sm truncate">
                      {offer.listing
                        ? displayListingTitle(offer.listing)
                        : offer.display_name || offer.listing_id}
                    </span>
                    <button
                      type="button"
                      disabled={unlinking}
                      onClick={() => {
                        if (!confirm("Unlink this listing from the product?"))
                          return;
                        onUnlink(offer.id);
                      }}
                      className="px-2 py-1 rounded border border-red-500/20 text-red-400 text-xs font-bold normal-case tracking-normal inline-flex items-center gap-1"
                    >
                      <Unlink size={10} /> Unlink
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <select
                value={linkListingId}
                onChange={(e) => onLinkListingIdChange(e.target.value)}
                className="flex-1 bg-muted border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-500/40"
                aria-label="Listing to link"
                data-testid="catalog-link-listing-select"
              >
                <option value="">Select a listing to link…</option>
                {linkableListings.map((l) => (
                  <option key={l.id} value={l.id}>
                    {displayListingTitle(l)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!linkListingId || linking}
                onClick={onLink}
                className="px-4 py-2 rounded-lg border border-violet-500/30 text-primary text-xs font-bold normal-case tracking-normal disabled:opacity-40"
                data-testid="catalog-link-listing-submit"
              >
                Link listing
              </button>
            </div>
            {linkError ? (
              <p className="text-sm text-red-400">
                {getErrorMessage(linkError)}
              </p>
            ) : null}
          </div>
        </>
      )}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg border border-border text-xs font-bold normal-case tracking-normal"
        >
          Close
        </button>
      </div>
    </DialogShell>
  );
}

function ProductFields({
  form,
  onChange,
}: {
  form: ProductForm;
  onChange: (f: ProductForm) => void;
}) {
  return (
    <div className="space-y-4">
      <label className="block space-y-1">
        <span className="text-xs font-semibold normal-case tracking-normal text-muted-foreground">
          Title
        </span>
        <input
          value={form.title}
          minLength={3}
          maxLength={200}
          required
          onChange={(e) => onChange({ ...form, title: e.target.value })}
          className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-500/40"
          data-testid="catalog-form-title"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-semibold normal-case tracking-normal text-muted-foreground">
          Description
        </span>
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
          className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-500/40 resize-none"
        />
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="block space-y-1">
          <span className="text-xs font-semibold normal-case tracking-normal text-muted-foreground">
            Slug (optional)
          </span>
          <input
            value={form.slug}
            onChange={(e) => onChange({ ...form, slug: e.target.value })}
            placeholder="premium-us-pool"
            className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-sm font-mono outline-none focus:border-violet-500/40"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold normal-case tracking-normal text-muted-foreground">
            Status
          </span>
          <select
            value={form.status}
            onChange={(e) =>
              onChange({
                ...form,
                status: e.target.value as CatalogProductStatus,
              })
            }
            className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-500/40"
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function DialogShell({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      size={wide ? "xl" : "lg"}
      contentClassName="record-family space-y-4"
    >
      {children}
    </Modal>
  );
}

function DialogActions({
  onClose,
  onSubmit,
  submitting,
  submitLabel,
}: {
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button
        type="button"
        onClick={onClose}
        className="px-4 py-2 rounded-lg border border-border text-xs font-bold normal-case tracking-normal"
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={submitting}
        onClick={onSubmit}
        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold normal-case tracking-normal disabled:opacity-50"
        data-testid="catalog-form-submit"
      >
        {submitLabel}
      </button>
    </div>
  );
}
