/**
 * Live-devnet escrow settle smoke (R-01).
 * Funds buyer from the oracle wallet (no faucet airdrop), initializes escrow,
 * verifies wrong-seller settle is rejected, then settles correctly.
 *
 * Usage (from services/solana-programs/proxyhub):
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=../../../infra/oracle-keypair.json \
 *   npx ts-node --transpile-only ../../scripts/live-escrow-settle-smoke.ts
 */
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import BN from 'bn.js';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Proxyhub as Program;
  const accounts = program.account as any;
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  console.log('program', program.programId.toBase58());
  console.log('oracle ', payer.publicKey.toBase58());
  console.log('balance', await connection.getBalance(payer.publicKey));

  const [programStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('program_state')],
    program.programId,
  );
  try {
    await accounts.programState.fetch(programStatePda);
    console.log('program_state already initialized');
  } catch {
    console.log('initializing program_state…');
    await program.methods
      .initializeProgram(3)
      .accounts({
        admin: payer.publicKey,
        programState: programStatePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  const buyer = Keypair.generate();
  const seller = Keypair.generate();
  const attacker = Keypair.generate();
  const fundIx = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: buyer.publicKey,
    lamports: Math.floor(0.5 * LAMPORTS_PER_SOL),
  });
  const fundTx = new Transaction().add(fundIx);
  await provider.sendAndConfirm(fundTx, [payer]);
  console.log('funded buyer', buyer.publicKey.toBase58());

  const [escrowPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), buyer.publicKey.toBuffer(), seller.publicKey.toBuffer()],
    program.programId,
  );
  const amount = Math.floor(0.1 * LAMPORTS_PER_SOL);
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  await program.methods
    .initializeEscrow(new BN(amount), new BN(10), new BN(expiresAt))
    .accounts({
      escrow: escrowPda,
      buyer: buyer.publicKey,
      seller: seller.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([buyer])
    .rpc();
  console.log('escrow', escrowPda.toBase58());

  let rejected = false;
  try {
    await program.methods
      .settleEscrow(new BN(10))
      .accounts({
        escrow: escrowPda,
        buyer: buyer.publicKey,
        seller: attacker.publicKey,
      })
      .rpc();
  } catch (err: any) {
    rejected = true;
    const text = `${err?.message ?? ''} ${JSON.stringify(err?.error ?? {})}`;
    if (!/ConstraintAddress|address constraint|ConstraintRaw|raw constraint/i.test(text)) {
      throw new Error(`unexpected reject reason: ${text}`);
    }
    console.log('wrong-seller settle rejected (expected)');
  }
  if (!rejected) throw new Error('wrong-seller settle was accepted');

  const sellerBefore = await connection.getBalance(seller.publicKey);
  await program.methods
    .settleEscrow(new BN(4))
    .accounts({
      escrow: escrowPda,
      buyer: buyer.publicKey,
      seller: seller.publicKey,
    })
    .rpc();
  const sellerAfter = await connection.getBalance(seller.publicKey);
  const paid = sellerAfter - sellerBefore;
  console.log('seller_paid_lamports', paid);

  // Settle closes the escrow account (refund + rent swept to buyer, PDA freed).
  const closed = await connection.getAccountInfo(escrowPda);
  if (closed !== null) throw new Error('escrow account still exists after settle');
  console.log('escrow account closed after settle (PDA freed)');
  if (paid !== Math.floor(amount * 0.4)) {
    throw new Error(`expected seller payout ${Math.floor(amount * 0.4)}, got ${paid}`);
  }
  console.log('LIVE DEVNET ESCROW SETTLE SMOKE OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
