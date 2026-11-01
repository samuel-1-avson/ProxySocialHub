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
    providerHotkey: string,
    // Offer edits re-sign the merged (current) status; creates always sign 'active'.
    status: string = 'active'
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
        status,
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

export async function raceTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(new Error(message)), ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** 32-byte seed from dashboard `provider_signing_key` (base58 seed or 64-byte keypair). */
export function parseProviderSigningSeed(secretB58: string): Uint8Array {
    const raw = bs58.decode(secretB58.trim());
    if (raw.length === 32) return raw;
    if (raw.length === 64) return raw.slice(0, 32);
    throw new Error('provider signing key must be 32 or 64 bytes');
}

export async function publicKeyFromProviderSecret(secretB58: string): Promise<string> {
    const { getPublicKeyAsync } = await import('@noble/ed25519');
    const pub = await getPublicKeyAsync(parseProviderSigningSeed(secretB58));
    return bs58.encode(pub);
}

export async function signListingOfferProof(
    form: CreateListingRequest,
    providerNodeId: string,
    gatewayNodeId: string | undefined,
    providerHotkey: string,
    signMessage: SignMessageFn,
    status: string = 'active'
): Promise<ProviderProofEnvelope> {
    const { envelope } = await buildListingOfferProofInput(
        form,
        providerNodeId,
        gatewayNodeId,
        providerHotkey,
        status
    );
    const message = buildProviderProofMessage(envelope);
    const encoded = new TextEncoder().encode(message);
    const sigBytes = await signMessage(encoded);
    return {
        ...envelope,
        signature: bs58.encode(sigBytes),
    };
}

/** Which credential signs the listing proof, or 'none' when the UI must offer key recovery. */
export type ListingSignerKind = 'local-secret' | 'wallet' | 'dev' | 'none';

export interface ListingSignerInput {
    /** A browser-stored provider secret exists for this node. */
    hasSecret: boolean;
    /** Provider hotkey derived from that secret ('' when unknown). */
    deviceHotkey: string;
    /** Hotkey the node registered ('' when the node never reported one). */
    nodeHotkey: string;
    walletConnected: boolean;
    walletCanSign: boolean;
    walletHotkey: string;
    devServerSigning: boolean;
}

/**
 * Pick the listing-proof signer. A browser secret matching the node hotkey wins, then a
 * connected wallet matching it, then dev server signing. 'none' means the caller must
 * show key recovery (CLI-configured nodes keep their secret in provider.toml, outside
 * this browser) or throw when the policy requires proof.
 */
export function resolveListingSigner(input: ListingSignerInput): ListingSignerKind {
    const nodeHotkey = input.nodeHotkey.trim();
    if (input.hasSecret && (!nodeHotkey || input.deviceHotkey === nodeHotkey)) {
        return 'local-secret';
    }
    if (
        input.walletConnected &&
        input.walletCanSign &&
        input.walletHotkey !== '' &&
        (!nodeHotkey || input.walletHotkey === nodeHotkey)
    ) {
        return 'wallet';
    }
    if (input.devServerSigning) {
        return 'dev';
    }
    return 'none';
}

/** Sign with the same Ed25519 seed written into provider.toml (no wallet popup). */
export async function signListingOfferWithSecret(
    form: CreateListingRequest,
    providerNodeId: string,
    gatewayNodeId: string | undefined,
    secretB58: string,
    status: string = 'active'
): Promise<ProviderProofEnvelope> {
    const { signAsync } = await import('@noble/ed25519');
    const seed = parseProviderSigningSeed(secretB58);
    const hotkey = await publicKeyFromProviderSecret(secretB58);
    const { envelope } = await buildListingOfferProofInput(
        form,
        providerNodeId,
        gatewayNodeId,
        hotkey,
        status
    );
    const encoded = new TextEncoder().encode(buildProviderProofMessage(envelope));
    const sigBytes = await signAsync(encoded, seed);
    return {
        ...envelope,
        signature: bs58.encode(sigBytes),
    };
}
