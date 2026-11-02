/**
 * Contract check for wallet-provider coverage on signing surfaces.
 * Run: npm run test:wallet-boundary
 *
 * Regression guard: layouts gated the Solana wallet provider behind path
 * allowlists (e.g. marketplace only mounted it on /marketplace/create), so
 * the Buy dialog on listing/map pages ran on the disconnected default
 * wallet context — signed-in buyers were told to connect a wallet forever,
 * and the library connect button inside a Radix dialog was unreachable.
 * These assertions keep every commerce/signing shell wallet-mounted, keep
 * the buy dialog self-sufficient, and keep the unlock prompt on the direct
 * connect control instead of the library wallet modal.
 */
import { readFileSync } from 'node:fs';

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// 1. Authenticated/commerce layouts mount the wallet for the whole shell.
for (const rel of [
  '../src/app/marketplace/layout.tsx',
  '../src/app/app/layout.tsx',
  '../src/app/dashboard/layout.tsx',
  '../src/app/provider/layout.tsx',
]) {
  const src = read(rel);
  assert(
    /<AppShell\s+withWallet[\s>]/.test(src),
    `${rel} must mount AppShell withWallet for the whole shell`,
  );
  assert(
    !/withWallet=\{/.test(src),
    `${rel} must not gate the wallet provider behind a path allowlist`,
  );
}

// 2. The buy dialog guarantees its own wallet provider on any route.
const buy = read('../src/components/BuyListingModal.tsx');
assert(
  buy.includes('<WalletBoundary>') && buy.includes('BuyListingModalInner'),
  'BuyListingModal must wrap its inner dialog in WalletBoundary',
);
assert(
  buy.includes('isOwnListing'),
  'BuyListingModal must surface the self-purchase rule before wallet prompts',
);

// 3. The unlock prompt connects directly (own picker), never via the
// library wallet button/modal that dead-ends inside Radix dialogs.
const prompt = read('../src/components/UnlockWalletPrompt.tsx');
assert(
  prompt.includes('WalletConnectControl'),
  'UnlockWalletPrompt must use WalletConnectControl',
);
assert(
  !prompt.includes('<SolanaWalletButton') && !prompt.includes('<WalletMultiButton') && !prompt.includes('components/SolanaWalletButton'),
  'UnlockWalletPrompt must not use the library wallet button/modal',
);

console.log('wallet boundary contract OK');
