/**
 * Access Passes API — wallet-native NFT entitlements (replaces custodial subscriptions)
 */

import { apiGet, apiPost } from './client';

export type PassTier = 'none' | 'bronze' | 'silver' | 'gold';

export interface PassCatalogItem {
    tier: PassTier | string;
    name: string;
    mint: string;
    price_sol: number;
    bandwidth_limit_gb: number | null;
    listing_limit: number;
    api_access: boolean;
    priority_support: boolean;
    purchase_url?: string;
    benefits: string[];
}

export interface PassCatalogResponse {
    passes: PassCatalogItem[];
    treasury: string;
    purchase_mode: string;
    entitlement_model: string;
    notes?: string;
}

export interface MyPassResponse {
    tier: PassTier | string;
    source: string;
    name: string;
    wallet: string;
    holds: Record<string, boolean>;
    bandwidth_limit_gb: number | null;
    listing_limit: number;
    features: {
        api_access?: boolean;
        analytics?: boolean;
        team_members?: number;
    };
    priority_support: boolean;
    quota: {
        remaining_gb: number;
        unlimited: boolean;
        limit_gb: number;
    };
    legacy_access_until: string | null;
    mints: {
        bronze: string;
        silver: string;
        gold: string;
    };
}

export interface PreparePassPurchaseResponse {
    mode: 'treasury_sol_transfer' | 'external' | string;
    purchase_id?: string;
    tier: string;
    mint: string;
    buyer_wallet: string;
    treasury?: string;
    amount_sol: number;
    amount_lamports?: number;
    memo?: string;
    purchase_url?: string;
    instructions?: string;
}

export interface PassMigrationResponse {
    current_tier: string;
    source: string;
    legacy_grace: boolean;
    legacy_access_until: string | null;
    airdrop_eligible_tier: string;
    airdrop_claim: {
        id: string;
        tier: string;
        status: string;
        wallet_address?: string;
    } | null;
    message: string;
}

export async function getPassCatalog(): Promise<PassCatalogResponse> {
    return apiGet<PassCatalogResponse>('/v1/passes/catalog');
}

export async function getMyPass(): Promise<MyPassResponse> {
    return apiGet<MyPassResponse>('/v1/passes/me');
}

export async function getPassMigration(): Promise<PassMigrationResponse> {
    return apiGet<PassMigrationResponse>('/v1/passes/migration');
}

export async function preparePassPurchase(tier: string, idempotencyKey?: string) {
    return apiPost<PreparePassPurchaseResponse>('/v1/passes/prepare-purchase', {
        tier,
        idempotency_key: idempotencyKey,
    });
}

export async function confirmPassPurchase(params: {
    tx_signature: string;
    purchase_id?: string;
    tier?: string;
}) {
    return apiPost<{ purchase: unknown; message: string; mint?: string }>('/v1/passes/confirm-purchase', params);
}
