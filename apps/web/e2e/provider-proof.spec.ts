import { expect, test } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

const signedListing = {
    id: 'signed-listing-1',
    seller_id: 'seller-1',
    node_id: 'node-provider-1',
    title: 'Provider Signed Residential Node',
    description: 'A listing backed by a provider signature.',
    price_per_gb: 0.0025,
    min_purchase_gb: 1,
    available_bandwidth_gb: 50,
    max_concurrency: 5,
    proxy_type: 'residential',
    protocol: 'http',
    status: 'active',
    country: 'US',
    city: 'Austin',
    isp: 'ProxyHubb Test ISP',
    uptime_percent: 99.7,
    sla_source: 'gateway',
    avg_latency_ms: 42,
    success_rate: 100,
    quality_score: 98,
    current_tier: 'Gold',
    views_count: 0,
    saves_count: 0,
    orders_count: 0,
    total_sales: 0,
    rating: 5,
    staked_amount: 0,
    priority_rank: 0,
    is_priority: false,
    listing_offer_verified: true,
    listing_offer_signer: '7YWHm4VxProviderHotkeyExample11111111111111111',
    listing_offer_signed_at: '2026-06-02T14:31:00Z',
    created_at: '2026-06-02T14:31:00Z',
    seller: {
        id: 'seller-1',
        username: 'signed-provider',
        verified: true,
        avg_rating: 5,
    },
};

test.describe('provider proof rendering', () => {
    test('shows provider-signed listing proof badge on marketplace cards', async ({ page }) => {
        await page.route('**/v1/listings**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ listings: [signedListing], total: 1, page: 1, limit: 20 }),
            });
        });
        await page.route('**/v1/reputation/telemetry**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ reputation_score: 0, zk_proof: null }),
            });
        });

        await page.goto(`${BASE_URL}/marketplace`, { waitUntil: 'domcontentloaded' });

        await expect(page.getByText('Provider Signed Residential Node')).toBeVisible();
        await expect(page.getByText('signed').first()).toBeVisible();
    });
});
