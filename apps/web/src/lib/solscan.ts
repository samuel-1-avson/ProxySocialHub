/** Solscan deep links aligned with NEXT_PUBLIC_SOLANA_NETWORK / devnet default. */

export function solanaClusterForExplorer(): string {
    const n = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
    if (n === 'mainnet-beta' || n === 'mainnet') return 'mainnet';
    return n;
}

export function getSolscanTxUrl(signature: string): string {
    const cluster = solanaClusterForExplorer();
    if (!cluster || cluster === 'mainnet') {
        return `https://solscan.io/tx/${signature}`;
    }
    return `https://solscan.io/tx/${signature}?cluster=${cluster}`;
}

export function getSolscanAccountUrl(address: string): string {
    const cluster = solanaClusterForExplorer();
    if (!cluster || cluster === 'mainnet') {
        return `https://solscan.io/account/${address}`;
    }
    return `https://solscan.io/account/${address}?cluster=${cluster}`;
}
