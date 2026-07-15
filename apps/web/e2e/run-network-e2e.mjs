/**
 * Runs network-unified Playwright tests with NEXT_PUBLIC_UNIFIED_NETWORK for dev:e2e.
 * Usage (from apps/web): node e2e/run-network-e2e.mjs
 */
import { spawnSync } from 'node:child_process';

const env = {
    ...process.env,
    PLAYWRIGHT_UNIFIED_NETWORK: '1',
    NEXT_PUBLIC_UNIFIED_NETWORK: '1',
};

const result = spawnSync(
    'npx',
    ['playwright', 'test', 'e2e/network-unified.spec.ts', '--project=chromium'],
    { stdio: 'inherit', env, shell: true },
);

process.exit(result.status ?? 1);
