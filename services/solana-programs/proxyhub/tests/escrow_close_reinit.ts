import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import BN from 'bn.js';
import { expect } from 'chai';

/**
 * Regression coverage for the escrow PDA reuse bug (audit follow-up 2026-08-21):
 * settle_escrow / settle_escrow_multisig previously left the escrow account
 * on-chain in a terminal state, so the buyer+seller legacy PDA could never be
 * re-initialized (`init` fails on an existing account) — the pair was bricked
 * after their first completed or refunded purchase.
 *
 * Settle now closes the account (refund + rent swept to the buyer), and a new
 * close_escrow instruction reclaims terminal legacy escrows created before the
 * patch.
 */
describe('escrow close + reinitialize regression', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Proxyhub as Program;
  const programAccounts = program.account as any;

  function findProgramState(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from('program_state')], program.programId);
  }

  function findEscrow(buyerKey: PublicKey, sellerKey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), buyerKey.toBuffer(), sellerKey.toBuffer()],
      program.programId,
    );
  }

  async function airdrop(pubkey: PublicKey, sol = 5) {
    const sig = await provider.connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, 'confirmed');
  }

  async function ensureProgramState() {
    const [programStatePda] = findProgramState();
    try {
      await programAccounts.programState.fetch(programStatePda);
    } catch {
      await program.methods
        .initializeProgram(3)
        .accounts({
          admin: (provider.wallet as anchor.Wallet).publicKey,
          programState: programStatePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    return programStatePda;
  }

  const ESCROW_AMOUNT = LAMPORTS_PER_SOL / 10;

  async function initEscrow(buyer: Keypair, seller: Keypair): Promise<PublicKey> {
    const [escrowPda] = findEscrow(buyer.publicKey, seller.publicKey);
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    await program.methods
      .initializeEscrow(new BN(ESCROW_AMOUNT), new BN(10), new BN(expiresAt))
      .accounts({
        escrow: escrowPda,
        buyer: buyer.publicKey,
        seller: seller.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();
    return escrowPda;
  }

  before(async () => {
    await ensureProgramState();
  });

  it('frees the buyer+seller PDA after settle so the pair can transact again', async () => {
    const buyer = Keypair.generate();
    const seller = Keypair.generate();
    await airdrop(buyer.publicKey);

    const escrowPda = await initEscrow(buyer, seller);

    // Full-usage settle: everything to the seller, rent reserve to the buyer.
    await program.methods
      .settleEscrow(new BN(10))
      .accounts({
        escrow: escrowPda,
        buyer: buyer.publicKey,
        seller: seller.publicKey,
      })
      .rpc();

    const closed = await provider.connection.getAccountInfo(escrowPda);
    expect(closed, 'escrow must be closed after settle').to.be.null;

    // The bug: this second initializeEscrow used to fail with "account already
    // in use" because the settled account was never closed.
    const escrowPda2 = await initEscrow(buyer, seller);
    expect(escrowPda2.toBase58()).to.equal(escrowPda.toBase58());

    const escrow = await programAccounts.escrow.fetch(escrowPda2);
    expect(escrow.status).to.deep.include({ pending: {} });
    expect(escrow.amount.toNumber()).to.equal(ESCROW_AMOUNT);
  });

  it('close_escrow rejects a non-terminal (pending) escrow', async () => {
    const buyer = Keypair.generate();
    const seller = Keypair.generate();
    await airdrop(buyer.publicKey);
    const escrowPda = await initEscrow(buyer, seller);

    let rejected = false;
    try {
      await program.methods
        .closeEscrow()
        .accounts({
          authority: buyer.publicKey,
          escrow: escrowPda,
          buyer: buyer.publicKey,
        })
        .signers([buyer])
        .rpc();
    } catch (err: any) {
      rejected = true;
      const text = `${err?.error?.errorCode?.code ?? ''} ${err?.message ?? ''}`;
      expect(/InvalidStatus/i.test(text), `expected InvalidStatus, got: ${text}`).to.be.true;
    }
    expect(rejected, 'close_escrow accepted a pending escrow').to.be.true;

    // Escrow is untouched.
    const escrow = await programAccounts.escrow.fetch(escrowPda);
    expect(escrow.status).to.deep.include({ pending: {} });
  });

  it('close_escrow rejects a caller that is not buyer, seller or admin', async () => {
    const buyer = Keypair.generate();
    const seller = Keypair.generate();
    const stranger = Keypair.generate();
    await airdrop(buyer.publicKey);
    await airdrop(stranger.publicKey, 1);
    const escrowPda = await initEscrow(buyer, seller);

    let rejected = false;
    try {
      await program.methods
        .closeEscrow()
        .accounts({
          authority: stranger.publicKey,
          escrow: escrowPda,
          buyer: buyer.publicKey,
        })
        .signers([stranger])
        .rpc();
    } catch (err: any) {
      rejected = true;
      const text = `${err?.error?.errorCode?.code ?? ''} ${err?.message ?? ''}`;
      expect(
        /Unauthorized|InvalidStatus/i.test(text),
        `expected Unauthorized/InvalidStatus, got: ${text}`,
      ).to.be.true;
    }
    expect(rejected, 'close_escrow accepted a stranger').to.be.true;
  });
});
