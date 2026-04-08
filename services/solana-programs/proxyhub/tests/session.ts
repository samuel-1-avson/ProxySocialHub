import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("session", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Session as Program;

  const buyer = Keypair.generate();
  const providerNode = Keypair.generate();
  const gatewayOperator = Keypair.generate();
  const oracle = provider.wallet as anchor.Wallet;

  function findGateway(operator: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("gateway"), operator.toBuffer()],
      program.programId
    );
  }

  function findSession(buyerKey: PublicKey, providerKey: PublicKey, createdAt: number): [PublicKey, number] {
    const tsBuffer = Buffer.alloc(8);
    tsBuffer.writeBigInt64LE(BigInt(createdAt));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("session"), buyerKey.toBuffer(), providerKey.toBuffer(), tsBuffer],
      program.programId
    );
  }

  async function airdrop(pubkey: PublicKey, sol: number = 10) {
    const sig = await provider.connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");
  }

  before(async () => {
    await Promise.all([
      airdrop(buyer.publicKey),
      airdrop(providerNode.publicKey),
      airdrop(gatewayOperator.publicKey),
    ]);
  });

  // =========================================================================
  // GATEWAY REGISTRATION
  // =========================================================================

  describe("gateway lifecycle", () => {
    it("registers a gateway node with minimum stake", async () => {
      const [gatewayPda] = findGateway(gatewayOperator.publicKey);

      const region = Buffer.alloc(8);
      Buffer.from("US-EAST").copy(region);
      const endpoint = Buffer.alloc(64);
      Buffer.from("wss://gw1.proxyhubb.com:4000").copy(endpoint);

      await program.methods
        .registerGateway(
          Array.from(region),
          Array.from(endpoint),
          new anchor.BN(LAMPORTS_PER_SOL) // 1 SOL stake
        )
        .accounts({
          gateway: gatewayPda,
          operator: gatewayOperator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([gatewayOperator])
        .rpc();

      const gw = await program.account.gatewayNode.fetch(gatewayPda);
      expect(gw.operator.toBase58()).to.equal(gatewayOperator.publicKey.toBase58());
      expect(gw.stake.toNumber()).to.equal(LAMPORTS_PER_SOL);
      expect(gw.isActive).to.be.true;
    });

    it("sends a heartbeat", async () => {
      const [gatewayPda] = findGateway(gatewayOperator.publicKey);

      await program.methods
        .gatewayHeartbeat(25) // 25ms latency
        .accounts({
          gateway: gatewayPda,
          operator: gatewayOperator.publicKey,
        })
        .signers([gatewayOperator])
        .rpc();

      const gw = await program.account.gatewayNode.fetch(gatewayPda);
      expect(gw.latencyMs).to.equal(25);
    });

    it("rejects heartbeat from non-operator", async () => {
      const [gatewayPda] = findGateway(gatewayOperator.publicKey);

      try {
        await program.methods
          .gatewayHeartbeat(50)
          .accounts({
            gateway: gatewayPda,
            operator: buyer.publicKey,
          })
          .signers([buyer])
          .rpc();
        expect.fail("Should have failed - wrong operator");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });

  // =========================================================================
  // SESSION LIFECYCLE
  // =========================================================================

  describe("session lifecycle", () => {
    const createdAt = Math.floor(Date.now() / 1000);
    let sessionPda: PublicKey;

    it("creates a session", async () => {
      const [pda] = findSession(buyer.publicKey, providerNode.publicKey, createdAt);
      sessionPda = pda;
      const [gatewayPda] = findGateway(gatewayOperator.publicKey);

      await program.methods
        .createSession(
          new anchor.BN(1_073_741_824),   // 1 GB bytes_limit
          new anchor.BN(50_000),           // rate_per_gb (lamports)
          new anchor.BN(3600),             // duration_seconds
          new anchor.BN(LAMPORTS_PER_SOL)  // escrow_amount
        )
        .accounts({
          session: sessionPda,
          buyer: buyer.publicKey,
          provider: providerNode.publicKey,
          gateway: gatewayPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      const session = await program.account.session.fetch(sessionPda);
      expect(session.buyer.toBase58()).to.equal(buyer.publicKey.toBase58());
      expect(session.provider.toBase58()).to.equal(providerNode.publicKey.toBase58());
      expect(session.bytesUsed.toNumber()).to.equal(0);
      expect(session.status).to.deep.include({ created: {} });
    });

    it("activates the session via gateway", async () => {
      const [gatewayPda] = findGateway(gatewayOperator.publicKey);

      await program.methods
        .activateSession()
        .accounts({
          session: sessionPda,
          gateway: gatewayPda,
        })
        .signers([gatewayOperator])
        .rpc();

      const session = await program.account.session.fetch(sessionPda);
      expect(session.status).to.deep.include({ active: {} });
    });

    it("reports usage", async () => {
      await program.methods
        .reportUsage(
          new anchor.BN(100_000_000), // 100 MB bytes_delta
          new anchor.BN(500)          // 500 requests_delta
        )
        .accounts({
          session: sessionPda,
          reporter: gatewayOperator.publicKey,
        })
        .signers([gatewayOperator])
        .rpc();

      const session = await program.account.session.fetch(sessionPda);
      expect(session.bytesUsed.toNumber()).to.equal(100_000_000);
      expect(session.requestsCount.toNumber()).to.equal(500);
    });

    it("completes the session with quality score", async () => {
      const [gatewayPda] = findGateway(gatewayOperator.publicKey);
      const usageProofCid = Buffer.alloc(46);
      Buffer.from("QmTest1234567890abcdefghijklmnopqrstuv").copy(usageProofCid);

      await program.methods
        .completeSession(
          85, // quality_score
          Array.from(usageProofCid)
        )
        .accounts({
          session: sessionPda,
          oracle: oracle.publicKey,
          buyer: buyer.publicKey,
          provider: providerNode.publicKey,
          gatewayNode: gatewayPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const session = await program.account.session.fetch(sessionPda);
      expect(session.qualityScore).to.equal(85);
      expect(session.status).to.deep.include({ completed: {} });
    });
  });
});
