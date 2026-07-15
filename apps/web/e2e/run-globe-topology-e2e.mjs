/**
 * Runs globe-topology Playwright tests with NEXT_PUBLIC_GLOBE_TOPOLOGY for dev:e2e.
 * Usage (from apps/web): node e2e/run-globe-topology-e2e.mjs
 */
import { spawnSync } from 'node:child_process';

const env = {
    ...process.env,
    PLAYWRIGHT_GLOBE_TOPOLOGY: '1',
    NEXT_PUBLIC_GLOBE_TOPOLOGY: '1',
};

const result = spawnSync(
    'npx',
    ['playwright', 'test', 'e2e/globe-topology.spec.ts', '--project=chromium', '--workers=1'],
    { stdio: 'inherit', env, shell: true },
);

process.exit(result.status ?? 1);
