import { expect, test, type Page } from '@playwright/test';
import {
    mockExplorerDecentralizationStatus,
    mockExplorerGate503Body,
    mockExplorerMetrics,
    mockExplorerNodeDetail,
    mockExplorerNodeGeo,
    mockExplorerNodesList,
    mockExplorerUnifiedMapResponse,
} from './fixtures/explorer';

export type StubExplorerOptions = {
    gateActive?: boolean;
    mockWebSocket?: boolean;
    /** After subscribe, emit link_update to exercise live refetch. */
    sendLinkUpdateAfterSubscribe?: boolean;
};

export async function stubExplorerApis(page: Page, options: StubExplorerOptions = {}) {
    await page.route('**/v1/explorer/nodes/geo**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockExplorerNodeGeo),
        });
    });

    await page.route('**/v1/explorer/metrics**', async (route) => {
        if (options.gateActive) {
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify(mockExplorerGate503Body),
            });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockExplorerMetrics),
        });
    });

    await page.route('**/v1/explorer/network/health**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                status: 'healthy',
                solana_health: 'healthy',
                database_health: 'healthy',
                active_nodes: 2,
                avg_response_time_ms: 42,
                last_checked: new Date().toISOString(),
            }),
        });
    });

    await page.route('**/v1/explorer/analytics**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                period: '24h',
                transaction_volume: [],
                active_wallets: [],
                message: '',
            }),
        });
    });

    await page.route(/\/v1\/explorer\/nodes\/[^/?]+$/, async (route) => {
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        const match = route.request().url().match(/\/nodes\/([^/?]+)(?:\?|$)/);
        const nodeId = match?.[1] ? decodeURIComponent(match[1]) : '';
        if (!nodeId || nodeId === 'geo') {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockExplorerNodeDetail(nodeId)),
        });
    });

    await page.route('**/v1/explorer/decentralization/status**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockExplorerDecentralizationStatus()),
        });
    });

    await page.route('**/v1/explorer/decentralization/writers**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ writers: [], total: 0 }),
        });
    });

    await page.route('**/v1/marketplace/map**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockExplorerUnifiedMapResponse()),
        });
    });

    if (options.mockWebSocket) {
        await page.routeWebSocket('**/v1/explorer/ws**', (ws) => {
            ws.onMessage((message) => {
                try {
                    const parsed = JSON.parse(String(message)) as { type?: string };
                    if (parsed.type === 'subscribe') {
                        ws.send(
                            JSON.stringify({
                                type: 'initial',
                                data: { nodes: [] },
                                timestamp: new Date().toISOString(),
                            }),
                        );
                        if (options.sendLinkUpdateAfterSubscribe) {
                            setTimeout(() => {
                                ws.send(
                                    JSON.stringify({
                                        type: 'link_update',
                                        data: {
                                            action: 'refresh',
                                            link_count: 1,
                                            topology_available: true,
                                        },
                                        timestamp: new Date().toISOString(),
                                    }),
                                );
                            }, 200);
                        }
                    }
                } catch {
                    /* ignore malformed client frames */
                }
            });
        });
    } else {
        await page.route('**/v1/explorer/ws**', async (route) => {
            await route.abort();
        });
    }

    await page.route('**/v1/explorer/nodes?**', async (route) => {
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockExplorerNodesList()),
        });
    });

    await page.route('**/v1/explorer/transactions**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ transactions: [], total: 0, page: 1, page_size: 5 }),
        });
    });

    await page.route('**/v1/explorer/blocks**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ blocks: [], total: 0, page: 1, page_size: 5 }),
        });
    });
}

/** Legacy WebGL globe was removed from the product; keep helper as an always-skip shim. */
export async function gotoExplorerGlobeReady(_page: Page) {
    test.skip(true, '3D explorer globe removed from product');
}
