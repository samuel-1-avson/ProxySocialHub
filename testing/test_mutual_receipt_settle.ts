/**
 * ProxyHubb Mutual Signed Session Receipt Settlement Simulation Test
 * Uses native Node.js crypto module (Ed25519) with zero external dependencies.
 * 
 * Verifies:
 * 1. Construction of the canonical mutual receipt message:
 *    receipt:v1:<escrow>:<buyer>:<seller>:<bytes_used>:<sequence_num>
 * 2. Provider signing (ReceiptOffer) and Buyer counter-signing (ReceiptAck) with Ed25519 keys
 * 3. Precompile signature validation
 * 4. Invariant settlement math:
 *    seller_payout = (amount * min(bytes, limit)) / limit
 *    buyer_refund = amount - seller_payout
 */

import crypto from 'node:crypto';

function buildReceiptCanonicalMessage(
  escrow: string,
  buyer: string,
  seller: string,
  bytesUsed: bigint,
  seqNum: bigint
): Buffer {
  const msgStr = `receipt:v1:${escrow}:${buyer}:${seller}:${bytesUsed.toString()}:${seqNum.toString()}`;
  return Buffer.from(msgStr, 'utf8');
}

function calculateSettlement(
  escrowAmountLamports: bigint,
  bandwidthLimitBytes: bigint,
  bytesUsed: bigint
): { sellerPayout: bigint; buyerRefund: bigint } {
  const cappedBytes = bytesUsed > bandwidthLimitBytes ? bandwidthLimitBytes : bytesUsed;
  const sellerPayout = bandwidthLimitBytes > 0n 
    ? (escrowAmountLamports * cappedBytes) / bandwidthLimitBytes 
    : 0n;
  const buyerRefund = escrowAmountLamports - sellerPayout;
  return { sellerPayout, buyerRefund };
}

async function runMutualReceiptTest() {
  console.log('--- ProxyHubb: Testing Mutual Signed Session Receipt Settlement ---');

  // 1. Generate Buyer and Provider Ed25519 Keypairs natively
  const buyerKeypair = crypto.generateKeyPairSync('ed25519');
  const providerKeypair = crypto.generateKeyPairSync('ed25519');

  const buyerPubHex = buyerKeypair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  const providerPubHex = providerKeypair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  const escrowPda = '8LZji5mK3B7YfG9M2W7o7v2gV3yqK7v4jK2L5mN8P9Q';

  console.log(`Buyer Pubkey (DER hex):    ${buyerPubHex.substring(0, 32)}...`);
  console.log(`Provider Pubkey (DER hex): ${providerPubHex.substring(0, 32)}...`);
  console.log(`Escrow PDA:                ${escrowPda}`);

  // 2. Set Up Session Escrow Parameters
  const escrowAmount = 100_000_000n; // 0.1 SOL in lamports
  const bandwidthLimitBytes = 10n * 1024n * 1024n * 1024n; // 10 GB limit
  const bytesUsed = 2_684_354_560n; // 2.5 GB transferred
  const sequenceNum = 5n;

  // 3. Provider generates and signs Receipt Offer
  const canonicalMsg = buildReceiptCanonicalMessage(
    escrowPda,
    buyerPubHex,
    providerPubHex,
    bytesUsed,
    sequenceNum
  );

  const providerSignature = crypto.sign(null, canonicalMsg, providerKeypair.privateKey);
  console.log(`Provider Signature:        ${providerSignature.toString('hex').substring(0, 32)}...`);

  // Verify Provider signature independently
  const isProviderValid = crypto.verify(null, canonicalMsg, providerKeypair.publicKey, providerSignature);
  if (!isProviderValid) {
    throw new Error('Provider signature failed verification');
  }

  // 4. Buyer validates and counter-signs Receipt Ack
  const buyerSignature = crypto.sign(null, canonicalMsg, buyerKeypair.privateKey);
  console.log(`Buyer Counter-Signature:   ${buyerSignature.toString('hex').substring(0, 32)}...`);

  // Verify Buyer signature independently
  const isBuyerValid = crypto.verify(null, canonicalMsg, buyerKeypair.publicKey, buyerSignature);
  if (!isBuyerValid) {
    throw new Error('Buyer signature failed verification');
  }

  // 5. Test Settlement Arithmetic Invariants
  const { sellerPayout, buyerRefund } = calculateSettlement(
    escrowAmount,
    bandwidthLimitBytes,
    bytesUsed
  );

  console.log(`\nSettlement Calculations:`);
  console.log(`Total Escrow:  ${escrowAmount} lamports (0.1 SOL)`);
  console.log(`Usage:         2.5 GB / 10.0 GB (25.0%)`);
  console.log(`Seller Payout: ${sellerPayout} lamports (0.025 SOL)`);
  console.log(`Buyer Refund:  ${buyerRefund} lamports (0.075 SOL)`);

  if (sellerPayout + buyerRefund !== escrowAmount) {
    throw new Error(`Invariant failed: sum (${sellerPayout + buyerRefund}) !== total (${escrowAmount})`);
  }
  if (sellerPayout !== 25_000_000n) {
    throw new Error(`Expected seller payout 25,000,000 lamports, got ${sellerPayout}`);
  }
  if (buyerRefund !== 75_000_000n) {
    throw new Error(`Expected buyer refund 75,000,000 lamports, got ${buyerRefund}`);
  }

  console.log('\n[PASS] All mutual signed receipt tests passed successfully!');
}

runMutualReceiptTest().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
