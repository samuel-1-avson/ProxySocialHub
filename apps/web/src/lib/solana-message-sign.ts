import bs58 from 'bs58';

type SignMessageFn = (message: Uint8Array) => Promise<Uint8Array>;

/** Build nonce + Ed25519 signature for large SOL withdrawals (>10 SOL). */
export async function signWithdrawalMessage(
    signMessage: SignMessageFn,
    amount: number
): Promise<{ nonce: string; signature: string }> {
    const nonce = Math.floor(Date.now() / 1000).toString();
    const message = `withdraw:${nonce}:${amount.toFixed(6)}`;
    const encoded = new TextEncoder().encode(message);
    const sigBytes = await signMessage(encoded);
    return { nonce, signature: bs58.encode(sigBytes) };
}

/** W-13: sign the server-issued withdrawal challenge message verbatim. */
export async function signWithdrawChallengeMessage(
    signMessage: SignMessageFn,
    serverMessage: string
): Promise<{ signature: string }> {
    const encoded = new TextEncoder().encode(serverMessage);
    const sigBytes = await signMessage(encoded);
    return { signature: bs58.encode(sigBytes) };
}

/** Build nonce + signature to schedule GDPR account deletion. */
export async function signDeleteAccountMessage(
    signMessage: SignMessageFn
): Promise<{ nonce: string; signature: string }> {
    const nonce = Math.floor(Date.now() / 1000).toString();
    const message = `delete-account:${nonce}`;
    const encoded = new TextEncoder().encode(message);
    const sigBytes = await signMessage(encoded);
    return { nonce, signature: bs58.encode(sigBytes) };
}
