/**
 * Paystack Inline (v2) popup for managed-wallet buyers.
 *
 * The server creates the transaction and returns an access code; the browser only
 * resumes it. No Paystack key is needed in the browser. The popup result is a hint:
 * the server always re-verifies the charge with Paystack before anything happens.
 */

const PAYSTACK_INLINE_SRC = 'https://js.paystack.co/v2/inline.js';

type PaystackCallbacks = {
    onSuccess?: (tx: { reference?: string }) => void;
    onCancel?: () => void;
    onError?: (err: { message?: string }) => void;
};

type PaystackPopInstance = {
    resumeTransaction: (accessCode: string, callbacks?: PaystackCallbacks) => void;
};

declare global {
    interface Window {
        PaystackPop?: new () => PaystackPopInstance;
    }
}

let loader: Promise<void> | null = null;

function loadPaystack(): Promise<void> {
    if (typeof window === 'undefined') return Promise.reject(new Error('Paystack needs a browser'));
    if (window.PaystackPop) return Promise.resolve();
    if (!loader) {
        loader = new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = PAYSTACK_INLINE_SRC;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => {
                loader = null;
                reject(new Error('Could not load Paystack. Check your connection and try again.'));
            };
            document.head.appendChild(script);
        });
    }
    return loader;
}

/** Opens the Paystack checkout for an access code. Resolves when the popup closes. */
export async function openPaystackCheckout(accessCode: string): Promise<'success' | 'cancelled'> {
    await loadPaystack();
    const Pop = window.PaystackPop;
    if (!Pop) throw new Error('Paystack did not load');
    return new Promise((resolve, reject) => {
        new Pop().resumeTransaction(accessCode, {
            onSuccess: () => resolve('success'),
            onCancel: () => resolve('cancelled'),
            onError: (err) => reject(new Error(err?.message || 'Paystack checkout failed')),
        });
    });
}
