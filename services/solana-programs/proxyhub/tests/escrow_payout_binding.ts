import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import BN from 'bn.js';
import { expect } from 'chai';

/**
 * Regression coverage for findings BC-01 / BC-02 (audit 2026-07-30):
 * settle_escrow, settle_escrow_multisig and execute_jury_verdict previously
 * accepted arbitrary buyer/seller payout accounts, letting any settling
 * authority (including the buyer) redirect escrowed funds. The program now
 * binds payout accounts to the escrow record (address = escrow.buyer/seller)
 * and binds execute_jury_verdict's escrow to the empaneled jury.
 *
 * These tests must pass before the patched program is redeployed anywhere
 * funds are at risk.
 */
describe('escrow payout binding regression (BC-01/BC-02)', () => {
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

  function findJury(escrowKey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('jury'), escrowKey.toBuffer()],
      program.programId,
    );
  }

  function findDispute(escrowKey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('dispute'), escrowKey.toBuffer()],
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

  function expectConstraintViolation(err: any) {
    const text = `${err?.error?.errorCode?.code ?? ''} ${err?.message ?? ''} ${JSON.stringify(err?.error ?? {})}`;
    expect(
      /ConstraintAddress|address constraint|ConstraintRaw|raw constraint/i.test(text),
      `expected an Anchor address/raw constraint violation, got: ${text}`,
    ).to.be.true;
  }

  before(async () => {
    await ensureProgramState();
  });

  describe('settle_escrow payout binding (BC-01)', () => {
    it('rejects settlement when the seller recipient is not the escrow seller', async () => {
      const buyer = Keypair.generate();
      const seller = Keypair.generate();
      const attacker = Keypair.generate();
      await airdrop(buyer.publicKey);
      const escrowPda = await initEscrow(buyer, seller);

      try {
        await program.methods
          .settleEscrow(new BN(10))
          .accounts({
            escrow: escrowPda,
            buyer: buyer.publicKey,
            seller: attacker.publicKey, // redirected payout — must be rejected
          })
          .rpc();
        expect.fail('settle_escrow accepted a seller account that is not escrow.seller');
      } catch (err: any) {
        expectConstraintViolation(err);
      }

      const escrow = await programAccounts.escrow.fetch(escrowPda);
      expect(escrow.status).to.deep.include({ pending: {} });
    });

    it('rejects settlement when the buyer recipient is not the escrow buyer', async () => {
      const buyer = Keypair.generate();
      const seller = Keypair.generate();
      const attacker = Keypair.generate();
      await airdrop(buyer.publicKey);
      const escrowPda = await initEscrow(buyer, seller);

      try {
        await program.methods
          .settleEscrow(new BN(10))
          .accounts({
            escrow: escrowPda,
            buyer: attacker.publicKey, // redirected refund — must be rejected
            seller: seller.publicKey,
          })
          .rpc();
        expect.fail('settle_escrow accepted a buyer account that is not escrow.buyer');
      } catch (err: any) {
        expectConstraintViolation(err);
      }

      const escrow = await programAccounts.escrow.fetch(escrowPda);
      expect(escrow.status).to.deep.include({ pending: {} });
    });

    it('rejects a buyer-initiated settlement that substitutes their own wallet as seller (theft scenario)', async () => {
      const buyer = Keypair.generate();
      const seller = Keypair.generate();
      await airdrop(buyer.publicKey);
      const escrowPda = await initEscrow(buyer, seller);

      try {
        await program.methods
          .settleEscrow(new BN(10))
          .accounts({
            authority: buyer.publicKey, // buyer is a valid settling authority...
            escrow: escrowPda,
            buyer: buyer.publicKey,
            seller: buyer.publicKey, // ...but redirects the seller payout to themselves
          })
          .signers([buyer])
          .rpc();
        expect.fail('buyer redirected the seller payout to their own wallet');
      } catch (err: any) {
        expectConstraintViolation(err);
      }

      const escrow = await programAccounts.escrow.fetch(escrowPda);
      expect(escrow.status).to.deep.include({ pending: {} });
    });

    it('settles successfully with the recorded buyer and seller (control)', async () => {
      const buyer = Keypair.generate();
      const seller = Keypair.generate();
      await airdrop(buyer.publicKey);
      const escrowPda = await initEscrow(buyer, seller);

      const sellerBefore = await provider.connection.getBalance(seller.publicKey);
      const buyerBefore = await provider.connection.getBalance(buyer.publicKey);
      await program.methods
        .settleEscrow(new BN(4))
        .accounts({
          escrow: escrowPda,
          buyer: buyer.publicKey,
          seller: seller.publicKey,
        })
        .rpc();

      // Settle closes the account: the PDA is freed and the buyer recovers the
      // unused share plus the rent reserve.
      const closed = await provider.connection.getAccountInfo(escrowPda);
      expect(closed, 'escrow account must be closed after settle').to.be.null;

      // 4/10 of 0.1 SOL = 0.04 SOL to the seller.
      const sellerAfter = await provider.connection.getBalance(seller.publicKey);
      expect(sellerAfter - sellerBefore).to.equal(ESCROW_AMOUNT * 0.4);

      // Buyer gets back the remaining 0.06 SOL plus the rent reserve.
      const buyerAfter = await provider.connection.getBalance(buyer.publicKey);
      expect(buyerAfter - buyerBefore).to.be.greaterThan(ESCROW_AMOUNT * 0.6);
    });
  });

  describe('execute_jury_verdict binding (BC-02)', () => {
    const jurors = [Keypair.generate(), Keypair.generate(), Keypair.generate()];

    async function initiateJury(escrowPda: PublicKey): Promise<PublicKey> {
      const [juryPda] = findJury(escrowPda);
      const [disputePda] = findDispute(escrowPda);
      await program.methods
        .initiateJuryDispute(jurors.map((j) => j.publicKey), new BN(0))
        .accounts({
          escrow: escrowPda,
          jury: juryPda,
          dispute: disputePda,
          initiator: (provider.wallet as anchor.Wallet).publicKey,
          programState: findProgramState()[0],
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      return juryPda;
    }

    async function resolveForBuyer(juryPda: PublicKey) {
      // Two of three jurors vote for the buyer → outcome Resolved (buyer wins).
      for (const juror of jurors.slice(0, 2)) {
        await program.methods
          .castVote(true)
          .accounts({
            jury: juryPda,
            juror: juror.publicKey,
            programState: findProgramState()[0],
          })
          .signers([juror])
          .rpc();
      }
    }

    before(async () => {
      await Promise.all(jurors.slice(0, 2).map((j) => airdrop(j.publicKey, 1)));
    });

    it('rejects verdict execution against an escrow the jury was not empaneled for', async () => {
      const buyerA = Keypair.generate();
      const sellerA = Keypair.generate();
      const buyerB = Keypair.generate();
      const sellerB = Keypair.generate();
      await Promise.all([airdrop(buyerA.publicKey), airdrop(buyerB.publicKey)]);
      const escrowA = await initEscrow(buyerA, sellerA);
      const escrowB = await initEscrow(buyerB, sellerB);
      const juryA = await initiateJury(escrowA);

      try {
        await program.methods
          .executeJuryVerdict()
          .accounts({
            jury: juryA,
            escrow: escrowB, // wrong escrow for this jury — must be rejected
            buyer: buyerB.publicKey,
            seller: sellerB.publicKey,
            programState: findProgramState()[0],
          })
          .rpc();
        expect.fail('execute_jury_verdict paired a jury with an unrelated escrow');
      } catch (err: any) {
        expectConstraintViolation(err);
      }

      const escrowBAccount = await programAccounts.escrow.fetch(escrowB);
      expect(escrowBAccount.status).to.deep.include({ pending: {} });
    });

    it('rejects verdict payouts to accounts other than the recorded buyer/seller', async () => {
      const buyer = Keypair.generate();
      const seller = Keypair.generate();
      const attacker = Keypair.generate();
      await airdrop(buyer.publicKey);
      const escrowPda = await initEscrow(buyer, seller);
      const juryPda = await initiateJury(escrowPda);
      await resolveForBuyer(juryPda);

      try {
        await program.methods
          .executeJuryVerdict()
          .accounts({
            jury: juryPda,
            escrow: escrowPda,
            buyer: attacker.publicKey, // redirected verdict payout — must be rejected
            seller: attacker.publicKey,
            programState: findProgramState()[0],
          })
          .rpc();
        expect.fail('execute_jury_verdict paid out to non-escrow accounts');
      } catch (err: any) {
        expectConstraintViolation(err);
      }

      const escrow = await programAccounts.escrow.fetch(escrowPda);
      expect(escrow.status).to.deep.include({ disputed: {} });
    });

    it('executes the verdict to the recorded parties (control)', async () => {
      const buyer = Keypair.generate();
      const seller = Keypair.generate();
      await airdrop(buyer.publicKey);
      const escrowPda = await initEscrow(buyer, seller);
      const juryPda = await initiateJury(escrowPda);
      await resolveForBuyer(juryPda);

      const buyerBefore = await provider.connection.getBalance(buyer.publicKey);
      await program.methods
        .executeJuryVerdict()
        .accounts({
          jury: juryPda,
          escrow: escrowPda,
          buyer: buyer.publicKey,
          seller: seller.publicKey,
          programState: findProgramState()[0],
        })
        .rpc();

      const escrow = await programAccounts.escrow.fetch(escrowPda);
      expect(escrow.status).to.deep.include({ settled: {} });

      // Buyer wins → full escrow amount returned to the recorded buyer.
      const buyerAfter = await provider.connection.getBalance(buyer.publicKey);
      expect(buyerAfter - buyerBefore).to.equal(ESCROW_AMOUNT);
    });
  });
});
