import { Keypair } from '@solana/web3.js';

const required = [
    'E2E_LIVE_GOVERNANCE',
    'TEST_BASE_URL',
    'TEST_BUYER_JWT',
    'NEXT_PUBLIC_PLAYWRIGHT_SOLANA_TEST_WALLET',
    'NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET',
    'NEXT_PUBLIC_SOLANA_PROGRAM_ID',
    'NEXT_PUBLIC_SOLANA_RPC_URL',
];

const missing = required.filter((key) => !process.env[key] || process.env[key] === '0');
if (missing.length) {
    console.error(`Missing live governance env: ${missing.join(', ')}`);
    process.exit(1);
}

const apiBase = process.env.TEST_API_URL || 'http://localhost:18080';
const token = process.env.TEST_BUYER_JWT?.trim() ?? '';

if (!token || token.includes('<') || token.split('.').length !== 3) {
    console.error(
        'TEST_BUYER_JWT must be a real JWT (three dot-separated segments), not a placeholder.\n' +
            'Mint one: .\\scripts\\mint-e2e-buyer-jwt.ps1 -WalletSecret $env:NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET\n' +
            'Or log in at /login and copy sessionStorage proxyhubb_token.'
    );
    process.exit(1);
}

const readinessRes = await fetch(`${apiBase}/v1/governance/execution-readiness`);
if (!readinessRes.ok) {
    console.error(`execution-readiness failed: ${readinessRes.status} ${await readinessRes.text()}`);
    process.exit(1);
}

const readiness = await readinessRes.json();
const exec = readiness.governance_execution ?? readiness;
if (!exec.ready) {
    console.error('governance_execution is not ready:', JSON.stringify(exec, null, 2));
    process.exit(1);
}

const profileRes = await fetch(`${apiBase}/v1/profile`, {
    headers: { Authorization: `Bearer ${token}` },
});
if (!profileRes.ok) {
    console.error(`profile preflight failed: ${profileRes.status} ${await profileRes.text()}`);
    process.exit(1);
}

let linkedWallet = null;
try {
    const payloadB64 = token.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    linkedWallet = payload.wallet ?? payload.wallet_address ?? null;
} catch {
    // fall through to profile body
}
if (!linkedWallet) {
    const profileBody = await profileRes.json();
    const profile = profileBody.profile ?? profileBody.user ?? profileBody;
    linkedWallet =
        profile.wallet_address ?? profile.walletAddress ?? profile.wallet ?? null;
}
if (!linkedWallet) {
    console.error(
        'TEST_BUYER_JWT has no wallet in claims. Run .\\scripts\\mint-e2e-buyer-jwt.ps1 -WalletFromPlaywrightSecret'
    );
    process.exit(1);
}

function parseSecret(raw) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
        return Uint8Array.from(JSON.parse(trimmed));
    }
    const binary = Buffer.from(trimmed, 'base64');
    return Uint8Array.from(binary);
}

const secret = process.env.NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET;
const keypair = Keypair.fromSecretKey(parseSecret(secret));
const testWallet = keypair.publicKey.toBase58();

if (testWallet !== linkedWallet) {
    console.error(
        `Playwright test wallet (${testWallet}) does not match profile wallet_address (${linkedWallet}).`
    );
    process.exit(1);
}

console.log(`Live governance preflight ok (wallet ${testWallet.slice(0, 8)}…).`);
