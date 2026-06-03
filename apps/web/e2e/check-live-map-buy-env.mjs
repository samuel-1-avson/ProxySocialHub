const required = [
  'E2E_LIVE_MAP_BUY',
  'TEST_BASE_URL',
  'TEST_BUYER_JWT',
  'E2E_LIVE_LISTING_ID',
  'NEXT_PUBLIC_PLAYWRIGHT_SOLANA_TEST_WALLET',
  'NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET',
  'NEXT_PUBLIC_SOLANA_PROGRAM_ID',
  'NEXT_PUBLIC_SOLANA_RPC_URL',
];

const missing = required.filter((key) => !process.env[key] || process.env[key] === '0');
if (missing.length) {
  console.error(`Missing live map-buy env: ${missing.join(', ')}`);
  process.exit(1);
}

const baseUrl = process.env.TEST_BASE_URL;
const listingId = process.env.E2E_LIVE_LISTING_ID;

const res = await fetch(`${baseUrl}/v1/listings/${listingId}`, {
  headers: {
    Authorization: `Bearer ${process.env.TEST_BUYER_JWT}`,
  },
});

if (!res.ok) {
  console.error(`Listing preflight failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const body = await res.json();
const listing = body.listing ?? body;
if (listing.status !== 'active') {
  console.error(`Listing ${listingId} is not active: ${listing.status}`);
  process.exit(1);
}

console.log(`Live map-buy preflight ok for listing ${listingId}.`);
