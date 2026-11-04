/**
 * Ask the offer's own node to sign it (control API listing_node_signatures.go).
 *
 * The node keeps provider_signing_key in provider.toml on the provider's computer and
 * long-polls the control API for offers to sign, so this page never needs the key. The
 * browser parks the exact request it is about to publish, waits for the node's proof, and
 * then publishes with it.
 */

import {
    getNodeOfferSignature,
    requestNodeOfferSignature,
    type NodeOfferSignatureBody,
    type ProviderProofEnvelope,
} from '@/lib/api/marketplace';

export type NodeSignatureFailure = 'offline' | 'refused' | 'expired';

export class NodeSignatureError extends Error {
    constructor(
        message: string,
        readonly reason: NodeSignatureFailure
    ) {
        super(message);
        this.name = 'NodeSignatureError';
    }
}

export interface NodeSignatureOptions {
    /** Shown in messages, e.g. the node's name. */
    nodeName: string;
    /** Called while waiting; `listening` says whether the node is asking for work. */
    onWaiting?: (listening: boolean) => void;
    pollMs?: number;
    /** How long to wait while the node is connected (it usually answers in a second or two). */
    listeningTimeoutMs?: number;
    /** How long to wait for a node that is not connected (it may be reconnecting). */
    offlineTimeoutMs?: number;
    signal?: AbortSignal;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        function onAbort() {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        }
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function isNotFound(error: unknown): boolean {
    const status = (error as { status?: number } | null)?.status;
    return status === 404;
}

export async function signOfferWithNode(
    body: NodeOfferSignatureBody,
    options: NodeSignatureOptions
): Promise<ProviderProofEnvelope> {
    const pollMs = options.pollMs ?? 1500;
    const listeningTimeoutMs = options.listeningTimeoutMs ?? 45_000;
    // A running node asks for work at least every ~25 s and counts as listening for 45 s
    // after, so "not listening" means stopped or too old; a short grace period is enough.
    const offlineTimeoutMs = options.offlineTimeoutMs ?? 12_000;
    const started = Date.now();

    let view = await requestNodeOfferSignature(body);
    let everListening = view.node_listening;
    for (;;) {
        if (view.status === 'signed' && view.proof) return view.proof;
        if (view.status === 'refused') {
            throw new NodeSignatureError(
                view.error || `${options.nodeName} declined to sign this offer.`,
                'refused'
            );
        }
        everListening = everListening || view.node_listening;
        const limit = everListening ? listeningTimeoutMs : offlineTimeoutMs;
        if (Date.now() - started >= limit) {
            throw new NodeSignatureError(
                everListening
                    ? `${options.nodeName} did not sign in time. Check that it is still running, then publish again.`
                    : `${options.nodeName} is not connected, so it cannot sign this offer. Start the ProxyHubb app (or provider-node) on that computer and keep it running. It needs version 1.0.13 or newer. Then publish again.`,
                'offline'
            );
        }
        options.onWaiting?.(view.node_listening);
        await sleep(pollMs, options.signal);
        try {
            view = await getNodeOfferSignature(view.id);
        } catch (error) {
            if (isNotFound(error)) {
                throw new NodeSignatureError(
                    'The signing request expired. Publish the offer again.',
                    'expired'
                );
            }
            throw error;
        }
    }
}
