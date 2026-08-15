import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { randomBytes } from "crypto";

describe("session_escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Proxyhub as Program;
  const programAccounts = program.account as any;
  const admin = provider.wallet as anchor.Wallet;

  const buyer = Keypair.generate();
  const seller = Keypair.generate();
  const attacker = Keypair.generate();

  function findProgramState(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("program_state")],
      program.programId
    );
  }

  function findSessionEscrow(sessionId: Buffer): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("session_escrow"), sessionId],
      program.programId
    );
  }

  async function airdrop(pubkey: PublicKey, sol: number = 5) {
    const sig = await provider.connection.requestAirdrop(
      pubkey,
      sol * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");
  }

  before(async () => {
    await airdrop(admin.publicKey, 10);
    await airdrop(buyer.publicKey, 5);
    await airdrop(seller.publicKey, 1);
    await airdrop(attacker.publicKey, 1);

    const [programStatePda] = findProgramState();
    try {
      await programAccounts.programState.fetch(programStatePda);
    } catch {
      await program.methods
        .initializeProgram()
        .accounts({
          programState: programStatePda,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
  });

  it("funds session escrow and settles pro-rata to seller", async () => {
    const sessionId = randomBytes(16);
    const [programStatePda] = findProgramState();
    const [escrowPda] = findSessionEscrow(sessionId);

    const amount = new BN(Math.floor(0.1 * LAMPORTS_PER_SOL));
    const bytesLimit = new BN(1_000_000_000);
    const price = new BN(10_000_000);
    const expiresAt = new BN(Math.floor(Date.now() / 1000) + 3600);

    await program.methods
      .initializeSessionEscrow(
        Array.from(sessionId),
        amount,
        bytesLimit,
        price,
        expiresAt
      )
      .accounts({
        buyer: buyer.publicKey,
        seller: seller.publicKey,
        sessionEscrow: escrowPda,
        systemProgram: SystemProgram.programId,
        programState: programStatePda,
      })
      .signers([buyer])
      .rpc();

    const beforeSeller = await provider.connection.getBalance(seller.publicKey);
    const beforeBuyer = await provider.connection.getBalance(buyer.publicKey);

    // Use half the bandwidth limit → half payout to seller
    const bytesUsed = new BN(500_000_000);
    await program.methods
      .settleSessionEscrow(bytesUsed)
      .accounts({
        oracle: admin.publicKey,
        sessionEscrow: escrowPda,
        buyer: buyer.publicKey,
        seller: seller.publicKey,
        programState: programStatePda,
      })
      .rpc();

    const afterSeller = await provider.connection.getBalance(seller.publicKey);
    const afterBuyer = await provider.connection.getBalance(buyer.publicKey);

    expect(afterSeller - beforeSeller).to.equal(Math.floor(0.05 * LAMPORTS_PER_SOL));
    expect(afterBuyer).to.be.greaterThan(beforeBuyer);

    // Account closed
    const info = await provider.connection.getAccountInfo(escrowPda);
    expect(info).to.equal(null);
  });

  it("rejects settle with wrong seller account", async () => {
    const sessionId = randomBytes(16);
    const [programStatePda] = findProgramState();
    const [escrowPda] = findSessionEscrow(sessionId);

    const amount = new BN(Math.floor(0.05 * LAMPORTS_PER_SOL));
    const bytesLimit = new BN(1_000_000_000);
    const price = new BN(10_000_000);
    const expiresAt = new BN(Math.floor(Date.now() / 1000) + 3600);

    await program.methods
      .initializeSessionEscrow(
        Array.from(sessionId),
        amount,
        bytesLimit,
        price,
        expiresAt
      )
      .accounts({
        buyer: buyer.publicKey,
        seller: seller.publicKey,
        sessionEscrow: escrowPda,
        systemProgram: SystemProgram.programId,
        programState: programStatePda,
      })
      .signers([buyer])
      .rpc();

    let rejected = false;
    try {
      await program.methods
        .settleSessionEscrow(new BN(1000))
        .accounts({
          oracle: admin.publicKey,
          sessionEscrow: escrowPda,
          buyer: buyer.publicKey,
          seller: attacker.publicKey,
          programState: programStatePda,
        })
        .rpc();
    } catch (err: any) {
      rejected = true;
      const text = `${err?.message ?? ""} ${JSON.stringify(err?.error ?? {})}`;
      expect(text).to.match(/ConstraintAddress|address constraint|AnchorError/i);
    }
    expect(rejected).to.equal(true);
  });
});
