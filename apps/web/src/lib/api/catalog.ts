/**
 * Marketplace catalog API (Phase 3A) — products and listing offers.
 */

import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type { Listing } from './marketplace';

export type CatalogProductStatus = 'draft' | 'active' | 'archived';

export interface CatalogProductSummary {
    id: string;
    slug: string;
    title: string;
    media?: unknown;
    status?: CatalogProductStatus;
}

export interface CatalogProduct {
    id: string;
    seller_id: string;
    slug: string;
    title: string;
    description: string;
    media?: unknown;
    status: CatalogProductStatus;
    created_at: string;
    updated_at: string;
}

export interface CatalogOffer {
    id: string;
    product_id: string;
    listing_id: string;
    sku?: string;
    display_name?: string;
    is_primary: boolean;
    sort_order: number;
    created_at?: string;
    listing?: Listing;
}

export interface CatalogProductView {
    product: CatalogProduct;
    offers: CatalogOffer[];
}

export interface CreateCatalogProductRequest {
    title: string;
    description?: string;
    slug?: string;
    media?: unknown;
    status?: CatalogProductStatus;
}

export interface UpdateCatalogProductRequest {
    title?: string;
    description?: string;
    slug?: string;
    media?: unknown;
    status?: CatalogProductStatus;
}

export interface LinkCatalogOfferRequest {
    listing_id: string;
    sku?: string;
    display_name?: string;
    is_primary?: boolean;
    sort_order?: number;
}

export function getMyCatalogProducts(page = 1, limit = 20) {
    return apiGet<{ products: CatalogProduct[]; total: number; page: number; limit: number }>(
        '/v1/catalog/products/my',
        { page: String(page), limit: String(limit) },
    );
}

export function getCatalogProduct(id: string) {
    return apiGet<CatalogProductView>(`/v1/catalog/products/${id}`);
}

export function createCatalogProduct(body: CreateCatalogProductRequest) {
    return apiPost<{ product: CatalogProduct }, CreateCatalogProductRequest>('/v1/catalog/products', body);
}

export function updateCatalogProduct(id: string, body: UpdateCatalogProductRequest) {
    return apiPatch<{ product: CatalogProduct }, UpdateCatalogProductRequest>(
        `/v1/catalog/products/${id}`,
        body,
    );
}

export function linkCatalogOffer(productId: string, body: LinkCatalogOfferRequest) {
    return apiPost<{ offer: CatalogOffer }, LinkCatalogOfferRequest>(
        `/v1/catalog/products/${productId}/offers`,
        body,
    );
}

export function unlinkCatalogOffer(productId: string, offerId: string) {
    return apiDelete<{ message?: string }>(`/v1/catalog/products/${productId}/offers/${offerId}`);
}

export const catalogKeys = {
    all: ['catalog'] as const,
    myProducts: (page?: number) => [...catalogKeys.all, 'my-products', page] as const,
    product: (id: string) => [...catalogKeys.all, 'product', id] as const,
};
