import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";

describe("session", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Session as Program;
  const programAccounts = program.account as any;

  const buyer = Keypair.generate();
  const providerNode = Keypair.generate();
  const gatewayOperator = Keypair.generate();
  const oracle = provider.wallet as anchor.Wallet;
  const treasury = Keypair.generate();

  function findGateway(operator: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("gateway"), operator.toBuffer()],
      program.programId
    );
  }

  function findSession(buyerKey: PublicKey, providerKey: PublicKey, expiresAt: number): [PublicKey, number] {
    const tsBuffer = Buffer.alloc(8);
    tsBuffer.writeBigInt64LE(BigInt(expiresAt));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("session"), buyerKey.toBuffer(), providerKey.toBuffer(), tsBuffer],
      program.programId
    );
  }

  function findConfig(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  }

  async function fundAccount(pubkey: PublicKey, sol: number = 2) {
    const lamports = sol * LAMPORTS_PER_SOL;

    try {
      const sig = await provider.connection.requestAirdrop(pubkey, lamports);
      await provider.connection.confirmTransaction(sig, "confirmed");
      return;
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes("429")) {
        throw err;
      }
    }

    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: pubkey,
        lamports,
      })
    );

    await provider.sendAndConfirm(tx, []);
  }

  before(async () => {
    await Promise.all([
      fundAccount(buyer.publicKey),
      fundAccount(providerNode.publicKey),
      fundAccount(gatewayOperator.publicKey),
    ]);

    // Initialize Config PDA (idempotent — ignore if already initialized)
    const [configPda] = findConfig();
    try {
      await program.methods
        .initializeConfig(oracle.publicKey, treasury.publicKey)
        .accounts({
          config: configPda,
          admin: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (err: any) {
      if (!String(err).includes("already in use")) throw err;
    }
  });

  // =========================================================================
  // CONFIG (BC-03/04 remediation)
  // =========================================================================

  describe("config", () => {
    it("initializes config bound to oracle + treasury", async () => {
      const [configPda] = findConfig();
      const cfg = await programAccounts.config.fetch(configPda);
      expect(cfg.admin.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
      expect(cfg.oracle.toBase58()).to.equal(oracle.publicKey.toBase58());
      expect(cfg.treasury.toBase58()).to.equal(treasury.publicKey.toBase58());
    });
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
          new BN(LAMPORTS_PER_SOL) // 1 SOL stake
        )
        .accounts({
          gateway: gatewayPda,
          operator: gatewayOperator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([gatewayOperator])
        .rpc();

      const gw = await programAccounts.gatewayNode.fetch(gatewayPda);
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

      const gw = await programAccounts.gatewayNode.fetch(gatewayPda);
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
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    let sessionPda: PublicKey;

    it("creates a session", async () => {
      const [pda] = findSession(buyer.publicKey, providerNode.publicKey, expiresAt);
      sessionPda = pda;
      const [gatewayPda] = findGateway(gatewayOperator.publicKey);

      await program.methods
        .createSession(
          new BN(1_073_741_824),   // 1 GB bytes_limit
          new BN(50_000),           // rate_per_gb (lamports)
          new BN(expiresAt),        // expires_at
          new BN(LAMPORTS_PER_SOL)  // escrow_amount
        )
        .accounts({
          session: sessionPda,
          buyer: buyer.publicKey,
          provider: providerNode.publicKey,
          gateway: gatewayOperator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      const session = await programAccounts.session.fetch(sessionPda);
      expect(session.buyer.toBase58()).to.equal(buyer.publicKey.toBase58());
      expect(session.provider.toBase58()).to.equal(providerNode.publicKey.toBase58());
      expect(session.bytesUsed.toNumber()).to.equal(0);
      expect(session.status).to.deep.include({ created: {} });
    });

    it("activates the session via gateway", async () => {
      await program.methods
        .activateSession()
        .accounts({
          session: sessionPda,
          gateway: gatewayOperator.publicKey,
        })
        .signers([gatewayOperator])
        .rpc();

      const session = await programAccounts.session.fetch(sessionPda);
      expect(session.status).to.deep.include({ active: {} });
    });

    it("reports usage", async () => {
      await program.methods
        .reportUsage(
          new BN(100_000_000), // 100 MB bytes_delta
          new BN(500)          // 500 requests_delta
        )
        .accounts({
          session: sessionPda,
          reporter: gatewayOperator.publicKey,
          config: findConfig()[0],
        })
        .signers([gatewayOperator])
        .rpc();

      const session = await programAccounts.session.fetch(sessionPda);
      expect(session.bytesUsed.toNumber()).to.equal(100_000_000);
      expect(session.requestsCount.toNumber()).to.equal(500);
    });

    it("rejects complete_session from wrong oracle", async () => {
      const [gatewayPda] = findGateway(gatewayOperator.publicKey);
      const [configPda] = findConfig();
      const rogue = Keypair.generate();
      await fundAccount(rogue.publicKey);
      const usageProofCid = Buffer.alloc(46);

      try {
        await program.methods
          .completeSession(90, Array.from(usageProofCid))
          .accounts({
            session: sessionPda,
            oracle: rogue.publicKey,
            config: configPda,
            buyer: buyer.publicKey,
            provider: providerNode.publicKey,
            gatewayNode: gatewayPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([rogue])
          .rpc();
        expect.fail("Should have failed - oracle not bound to config");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });

    it("completes the session with quality score (config-bound oracle)", async () => {
      const [gatewayPda] = findGateway(gatewayOperator.publicKey);
      const [configPda] = findConfig();
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
          config: configPda,
          buyer: buyer.publicKey,
          provider: providerNode.publicKey,
          gatewayNode: gatewayPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const session = await programAccounts.session.fetch(sessionPda);
      expect(session.qualityScore).to.equal(85);
      expect(session.status).to.deep.include({ completed: {} });
    });

    it("rejects slash_gateway from non-admin and wrong treasury", async () => {
      const [gatewayPda] = findGateway(gatewayOperator.publicKey);
      const [configPda] = findConfig();
      const rogue = Keypair.generate();
      await fundAccount(rogue.publicKey);

      try {
        await program.methods
          .slashGateway(50, "test")
          .accounts({
            gateway: gatewayPda,
            admin: rogue.publicKey,
            config: configPda,
            treasury: treasury.publicKey,
          })
          .signers([rogue])
          .rpc();
        expect.fail("Should have failed - admin not bound to config");
      } catch (err: any) {
        expect(err).to.exist;
      }

      try {
        await program.methods
          .slashGateway(50, "test")
          .accounts({
            gateway: gatewayPda,
            admin: provider.wallet.publicKey,
            config: configPda,
            treasury: rogue.publicKey,
          })
          .rpc();
        expect.fail("Should have failed - treasury not bound to config");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });
});
