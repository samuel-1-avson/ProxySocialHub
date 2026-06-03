import type { Page } from '@playwright/test';

export const GOVERNANCE_DEVNET_REQUIRED_ENV = [
    'E2E_LIVE_GOVERNANCE',
    'TEST_BASE_URL',
    'TEST_BUYER_JWT',
    'NEXT_PUBLIC_PLAYWRIGHT_SOLANA_TEST_WALLET',
    'NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET',
    'NEXT_PUBLIC_SOLANA_PROGRAM_ID',
    'NEXT_PUBLIC_SOLANA_RPC_URL',
] as const;

export function missingGovernanceDevnetEnv(): string[] {
    return GOVERNANCE_DEVNET_REQUIRED_ENV.filter(
        (key) => !process.env[key] || process.env[key] === '0'
    );
}

export function governanceBaseUrl(): string {
    return process.env.TEST_BASE_URL || 'http://localhost:4011';
}

export function governanceApiBase(): string {
    return process.env.TEST_API_URL || 'http://localhost:18080';
}

export async function applyBuyerAuth(page: Page, token: string): Promise<void> {
    const baseUrl = governanceBaseUrl().replace('localhost', '127.0.0.1');
    await page.context().addCookies([
        {
            name: 'proxyhubb_token',
            value: token,
            url: baseUrl,
        },
    ]);
    await page.addInitScript((jwt) => {
        sessionStorage.setItem('proxyhubb_token', jwt);
    }, token);
}
