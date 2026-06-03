/**
 * Provider listing offer proofs — must match control-api/internal/proofs/provider_signatures.go
 */

import bs58 from 'bs58';
import type { CreateListingRequest, ProviderProofEnvelope } from '@/lib/api/marketplace';

export const LISTING_OFFER_MESSAGE_TYPE = 'PROXYHUB_LISTING_OFFER';
export const PROVIDER_PROOF_VERSION = 'v1';

export type ListingOfferPayloadInput = {
    providerNodeId: string;
    gatewayNodeId?: string;
    title: string;
    description: string;
    proxyType: string;
    protocol: string;
    rotationType: string;
    country: string;
    isp: string;
    pricePerGb: number;
    minPurchaseGb: number;
    availableBandwidthGb: number;
    maxConcurrency: number;
    status: string;
    expiresAt: number;
};

export async function hashListingOfferPayload(payload: ListingOfferPayloadInput): Promise<string> {
    const msg =
        `PROXYHUB_LISTING_OFFER_PAYLOAD:v1:${payload.providerNodeId}:${payload.gatewayNodeId ?? ''}:` +
        `${payload.title}:${payload.description}:${payload.proxyType}:` +
        `${payload.protocol}:${payload.rotationType}:${payload.country}:${payload.isp}:` +
        `${format9(payload.pricePerGb)}:${format9(payload.minPurchaseGb)}:${format9(payload.availableBandwidthGb)}:` +
        `${payload.maxConcurrency}:${payload.status}:${payload.expiresAt}`;
    const encoder = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', encoder.encode(msg));
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

function format9(n: number): string {
    return n.toFixed(9);
}

export function buildProviderProofMessage(envelope: Omit<ProviderProofEnvelope, 'signature'>): string {
    return [
        envelope.message_type,
        envelope.version,
        envelope.provider_node_id,
        envelope.gateway_node_id ?? '',
        envelope.provider_hotkey,
        String(envelope.issued_at),
        envelope.nonce,
        envelope.payload_hash,
    ].join(':');
}

export function canonicalListingFields(form: CreateListingRequest): {
    rotationType: string;
    maxConcurrency: number;
    protocol: string;
    minPurchaseGb: number;
    description: string;
    country: string;
    isp: string;
} {
    return {
        rotationType: form.rotation_type?.trim() || 'static',
        maxConcurrency: form.max_concurrency && form.max_concurrency > 0 ? form.max_concurrency : 5,
        protocol: (form.protocol || 'http').trim().toLowerCase(),
        minPurchaseGb: form.min_purchase_gb ?? 0,
        description: form.description ?? '',
        country: form.country ?? '',
        isp: form.isp ?? '',
    };
}

export async function buildListingOfferProofInput(
    form: CreateListingRequest,
    providerNodeId: string,
    gatewayNodeId: string | undefined,
    providerHotkey: string
): Promise<{ payloadHash: string; envelope: Omit<ProviderProofEnvelope, 'signature'> }> {
    const canon = canonicalListingFields(form);
    const issuedAt = Math.floor(Date.now() / 1000);
    const payloadHash = await hashListingOfferPayload({
        providerNodeId,
        gatewayNodeId: gatewayNodeId ?? '',
        title: form.title,
        description: canon.description,
        proxyType: form.proxy_type,
        protocol: canon.protocol,
        rotationType: canon.rotationType,
        country: canon.country,
        isp: canon.isp,
        pricePerGb: form.price_per_gb,
        minPurchaseGb: canon.minPurchaseGb,
        availableBandwidthGb: form.available_bandwidth_gb,
        maxConcurrency: canon.maxConcurrency,
        status: 'active',
        expiresAt: form.listing_offer_expires_at ?? 0,
    });

    return {
        payloadHash,
        envelope: {
            message_type: LISTING_OFFER_MESSAGE_TYPE,
            version: PROVIDER_PROOF_VERSION,
            provider_node_id: providerNodeId,
            gateway_node_id: gatewayNodeId,
            provider_hotkey: providerHotkey,
            issued_at: issuedAt,
            nonce: crypto.randomUUID(),
            payload_hash: payloadHash,
        },
    };
}

export type SignMessageFn = (message: Uint8Array) => Promise<Uint8Array>;

export async function signListingOfferProof(
    form: CreateListingRequest,
    providerNodeId: string,
    gatewayNodeId: string | undefined,
    providerHotkey: string,
    signMessage: SignMessageFn
): Promise<ProviderProofEnvelope> {
    const { envelope } = await buildListingOfferProofInput(
        form,
        providerNodeId,
        gatewayNodeId,
        providerHotkey
    );
    const message = buildProviderProofMessage(envelope);
    const encoded = new TextEncoder().encode(message);
    const sigBytes = await signMessage(encoded);
    return {
        ...envelope,
        signature: bs58.encode(sigBytes),
    };
}
