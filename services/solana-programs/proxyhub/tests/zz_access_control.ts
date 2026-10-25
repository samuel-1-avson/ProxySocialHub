import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import BN from 'bn.js';
import { expect } from 'chai';

/**
 * Access control on the instructions that used to accept any signer (audit BC-CRIT-02..08,
 * BC-HIGH-01). Every denied case here is a transaction an attacker could send before the fix.
 *
 * The file sorts last on purpose: the multi-sig pause test adds oracle signers and briefly
 * pauses the program, and the earlier suites create the multisig oracle with keys this file
 * does not hold. The pause is always resumed and the threshold restored.
 */
describe('access control on admin-only instructions', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Proxyhub as Program;
  const programAccounts = program.account as any;
  const admin = provider.wallet as anchor.Wallet;
  const attacker = Keypair.generate();

  const ADDRESS_CONSTRAINT = /ConstraintAddress|address constraint/i;
  const UNAUTHORIZED = /Unauthorized/i;

  function pda(...seeds: (Buffer | Uint8Array)[]): PublicKey {
    return PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  }
  const programState = () => pda(Buffer.from('program_state'));
  const multisigOracle = () => pda(Buffer.from('multisig_oracle'));
  const u64le = (n: number | bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };

  async function airdrop(key: PublicKey, sol = 5) {
    const sig = await provider.connection.requestAirdrop(key, sol * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, 'confirmed');
  }

  async function expectDenied(label: string, run: () => Promise<unknown>, pattern: RegExp) {
    try {
      await run();
    } catch (err: any) {
      const text = [
        err?.error?.errorCode?.code,
        err?.error?.errorMessage,
        err?.message,
        ...(err?.logs ?? []),
      ].join(' ');
      expect(pattern.test(text), `${label}: rejected for the wrong reason: ${text}`).to.equal(true);
      return;
    }
    expect.fail(`${label}: the instruction was accepted but must be rejected`);
  }

  async function ensureProgramState() {
    try {
      await programAccounts.programState.fetch(programState());
    } catch {
      await program.methods
        .initializeProgram(3)
        .accounts({ admin: admin.publicKey, programState: programState(), systemProgram: SystemProgram.programId })
        .rpc();
    }
  }

  const oracleA = Keypair.generate();
  const oracleB = Keypair.generate();
  const oracleC = Keypair.generate();
  let originalThreshold: number | null = null;

  async function ensureMultisigOracle() {
    try {
      await programAccounts.multiSigOracle.fetch(multisigOracle());
    } catch {
      await program.methods
        .initializeMultisigOracle([oracleA.publicKey, oracleB.publicKey, oracleC.publicKey], 2)
        .accounts({ multisigOracle: multisigOracle(), admin: admin.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
    }
  }

  before(async () => {
    await airdrop(attacker.publicKey);
    await ensureProgramState();
    await ensureMultisigOracle();
  });

  // ---------------------------------------------------------------------------
  describe('update_program_config', () => {
    const args = [new BN(0), 100, new BN(LAMPORTS_PER_SOL), new BN(1_000_000_000), new BN(86_400)] as const;

    it('rejects a non-admin signer (could set the unstake cooldown to 1 second)', async () => {
      await expectDenied(
        'update_program_config',
        () =>
          program.methods
            .updateProgramConfig(args[0], args[1], args[2], args[3], new BN(1))
            .accounts({ oracle: attacker.publicKey })
            .signers([attacker])
            .rpc(),
        ADDRESS_CONSTRAINT,
      );
    });

    it('accepts the program admin', async () => {
      await program.methods
        .updateProgramConfig(args[0], args[1], args[2], args[3], args[4])
        .accounts({ oracle: admin.publicKey })
        .rpc();
      const cfg = await programAccounts.programConfig.fetch(pda(Buffer.from('program_config')));
      expect(cfg.unstakeCooldownSeconds.toNumber()).to.equal(86_400);
    });
  });

  // ---------------------------------------------------------------------------
  describe('stake_provider / unstake_provider', () => {
    const provider1 = Keypair.generate();
    const stakeAccount = () => pda(Buffer.from('stake'), provider1.publicKey.toBuffer());

    it('rejects staking by a non-admin signer', async () => {
      await expectDenied(
        'stake_provider',
        () =>
          program.methods
            .stakeProvider(provider1.publicKey, new BN(1_000_000))
            .accounts({ oracle: attacker.publicKey, stakeAccount: stakeAccount() })
            .signers([attacker])
            .rpc(),
        ADDRESS_CONSTRAINT,
      );
    });

    it('lets the admin stake, and rejects a non-admin withdrawal of that stake', async () => {
      await program.methods
        .stakeProvider(provider1.publicKey, new BN(2_000_000))
        .accounts({ oracle: admin.publicKey, stakeAccount: stakeAccount() })
        .rpc();
      const stake = await programAccounts.stakeAccount.fetch(stakeAccount());
      expect(stake.amount.toNumber()).to.equal(2_000_000);

      await expectDenied(
        'unstake_provider',
        () =>
          program.methods
            .unstakeProvider(provider1.publicKey, new BN(2_000_000))
            .accounts({ oracle: attacker.publicKey, stakeAccount: stakeAccount() })
            .signers([attacker])
            .rpc(),
        ADDRESS_CONSTRAINT,
      );
      const after = await programAccounts.stakeAccount.fetch(stakeAccount());
      expect(after.amount.toNumber()).to.equal(2_000_000);
    });
  });

  // ---------------------------------------------------------------------------
  describe('claim_bandwidth_rewards', () => {
    const epochId = Date.now();
    const poolPda = pda(Buffer.from('epoch-rewards'), u64le(epochId));
    const claimPda = (provider1: PublicKey) => pda(Buffer.from('epoch_claim'), u64le(epochId), provider1.toBuffer());
    const EMISSION = LAMPORTS_PER_SOL;
    const TOTAL_BYTES = 1_000;
    const provider1 = Keypair.generate();

    before(async () => {
      await program.methods
        .initializeEpochRewardPool(new BN(epochId), new BN(EMISSION), new BN(TOTAL_BYTES), new BN(3600))
        .accounts({ epochRewardPool: poolPda, authority: admin.publicKey, programState: programState(), systemProgram: SystemProgram.programId })
        .rpc();
    });

    const claim = (provider1Key: PublicKey, bytes: number, oracle: Keypair | null) => {
      const builder = program.methods
        .claimBandwidthRewards(new BN(epochId), new BN(bytes))
        .accounts({
          epochRewardPool: poolPda,
          epochClaim: claimPda(provider1Key),
          providerWallet: provider1Key,
          oracle: oracle ? oracle.publicKey : admin.publicKey,
          programState: programState(),
          systemProgram: SystemProgram.programId,
        });
      return oracle ? builder.signers([oracle]).rpc() : builder.rpc();
    };

    it('rejects a claim that is not signed by the program admin (could drain the pool)', async () => {
      const before = await provider.connection.getBalance(poolPda);
      await expectDenied('claim by attacker', () => claim(attacker.publicKey, TOTAL_BYTES, attacker), ADDRESS_CONSTRAINT);
      expect(await provider.connection.getBalance(poolPda)).to.equal(before);
    });

    it('pays the attested share once, and refuses a second claim for the same provider', async () => {
      const before = await provider.connection.getBalance(provider1.publicKey);
      await claim(provider1.publicKey, 250, null);
      const paid = (await provider.connection.getBalance(provider1.publicKey)) - before;
      expect(paid).to.equal(EMISSION / 4);

      const receipt = await programAccounts.epochClaimReceipt.fetch(claimPda(provider1.publicKey));
      expect(receipt.rewardLamports.toNumber()).to.equal(EMISSION / 4);

      await expectDenied('second claim', () => claim(provider1.publicKey, 250, null), /already in use|already been processed|0x0/i);
      expect((await provider.connection.getBalance(provider1.publicKey)) - before).to.equal(EMISSION / 4);
    });

    it('refuses more bytes than the epoch verified in total', async () => {
      const other = Keypair.generate();
      await expectDenied('oversized claim', () => claim(other.publicKey, TOTAL_BYTES + 1, null), /InvalidStatus|Invalid escrow status/i);
    });
  });

  // ---------------------------------------------------------------------------
  describe('multi_sig_pause_vote', () => {
    const msPause = (signer: Keypair, approvals: PublicKey[], extra: Keypair[], extraAsSigner = true) =>
      program.methods
        .multiSigPauseVote(approvals)
        .accounts({ programState: programState(), multisigOracle: multisigOracle(), oracleSigner: signer.publicKey })
        .remainingAccounts(extra.map((k) => ({ pubkey: k.publicKey, isSigner: extraAsSigner, isWritable: false })))
        .signers([signer, ...(extraAsSigner ? extra : [])])
        .rpc();

    const paused = async () => (await programAccounts.programState.fetch(programState())).paused as boolean;

    before(async () => {
      const mso = await programAccounts.multiSigOracle.fetch(multisigOracle());
      originalThreshold = mso.threshold as number;
      for (const key of [oracleA, oracleB]) {
        if (!mso.signers.some((s: PublicKey) => s.equals(key.publicKey))) {
          await program.methods
            .addOracleSigner(key.publicKey)
            .accounts({ multisigOracle: multisigOracle(), admin: admin.publicKey, programState: programState() })
            .rpc();
        }
      }
      await program.methods
        .updateThreshold(2)
        .accounts({ multisigOracle: multisigOracle(), admin: admin.publicKey, programState: programState() })
        .rpc();
    });

    after(async () => {
      if (await paused()) {
        await program.methods.emergencyResume().accounts({ programState: programState(), admin: admin.publicKey }).rpc();
      }
      if (originalThreshold !== null) {
        await program.methods
          .updateThreshold(originalThreshold)
          .accounts({ multisigOracle: multisigOracle(), admin: admin.publicKey, programState: programState() })
          .rpc();
      }
    });

    it('does not count public keys listed in instruction data', async () => {
      // One real signer naming the rest of the set: before the fix this paused the protocol.
      await expectDenied(
        'one signer naming the others',
        () => msPause(oracleA, [oracleA.publicKey, oracleB.publicKey, oracleC.publicKey], []),
        /InsufficientSignatures|Insufficient oracle signatures/i,
      );
      expect(await paused()).to.equal(false);
    });

    it('does not count another oracle key that did not sign the transaction', async () => {
      await expectDenied(
        'non-signing second key',
        () => msPause(oracleA, [], [oracleB], false),
        /InsufficientSignatures|Insufficient oracle signatures|signature verification failed|Signature/i,
      );
      expect(await paused()).to.equal(false);
    });

    it('rejects a signer outside the oracle set', async () => {
      await expectDenied('outside signer', () => msPause(attacker, [], []), UNAUTHORIZED);
    });

    it('pauses once the threshold of distinct oracle signers has actually signed', async () => {
      await msPause(oracleA, [], [oracleB]);
      expect(await paused()).to.equal(true);
    });
  });

  // ---------------------------------------------------------------------------
  describe('jury disputes and the legacy settle_escrow', () => {
    const buyer = Keypair.generate();
    const seller = Keypair.generate();
    const jurors = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
    const escrowPda = () => pda(Buffer.from('escrow'), buyer.publicKey.toBuffer(), seller.publicKey.toBuffer());
    const jury = () => pda(Buffer.from('jury'), escrowPda().toBuffer());
    const dispute = () => pda(Buffer.from('dispute'), escrowPda().toBuffer());

    before(async () => {
      await airdrop(buyer.publicKey);
      await program.methods
        .initializeEscrow(new BN(LAMPORTS_PER_SOL / 10), new BN(10), new BN(Math.floor(Date.now() / 1000) + 3600))
        .accounts({ escrow: escrowPda(), buyer: buyer.publicKey, seller: seller.publicKey, systemProgram: SystemProgram.programId })
        .signers([buyer])
        .rpc();
    });

    const initiate = (initiator: Keypair | null, jurorKeys: PublicKey[]) => {
      const builder = program.methods.initiateJuryDispute(jurorKeys, new BN(0)).accounts({
        escrow: escrowPda(),
        jury: jury(),
        dispute: dispute(),
        initiator: initiator ? initiator.publicKey : admin.publicKey,
        programState: programState(),
        systemProgram: SystemProgram.programId,
      });
      return initiator ? builder.signers([initiator]).rpc() : builder.rpc();
    };

    const settle = (authority: Keypair) =>
      program.methods
        .settleEscrow(new BN(0))
        .accounts({ authority: authority.publicKey, escrow: escrowPda(), buyer: buyer.publicKey, seller: seller.publicKey, programState: programState() })
        .signers([authority])
        .rpc();

    it('rejects a buyer-initiated settlement that reports zero usage', async () => {
      await expectDenied('buyer settle', () => settle(buyer), UNAUTHORIZED);
      await expectDenied('seller settle', () => settle(seller), UNAUTHORIZED);
      const escrow = await programAccounts.escrow.fetch(escrowPda());
      expect(escrow.status).to.deep.include({ pending: {} });
    });

    it('rejects a party seating its own jury', async () => {
      await expectDenied('buyer initiates', () => initiate(buyer, jurors.map((j) => j.publicKey)), ADDRESS_CONSTRAINT);
    });

    it('rejects a jury that includes the buyer or the seller', async () => {
      await expectDenied(
        'buyer on the jury',
        () => initiate(null, [jurors[0].publicKey, jurors[1].publicKey, buyer.publicKey]),
        /InvalidJuror|Invalid juror/i,
      );
    });

    it('lets the admin open a dispute with an independent jury', async () => {
      await initiate(null, jurors.map((j) => j.publicKey));
      const escrow = await programAccounts.escrow.fetch(escrowPda());
      expect(escrow.status).to.deep.include({ disputed: {} });
    });
  });

  // ---------------------------------------------------------------------------
  describe('oracle-only writes', () => {
    const sessionId = Array.from(Keypair.generate().publicKey.toBytes().slice(0, 16));
    const proposalId = Array.from(Keypair.generate().publicKey.toBytes().slice(0, 16));
    const escrowKey = Keypair.generate().publicKey;
    const reviewer = Keypair.generate().publicKey;

    const lock = (signer: Keypair | null) => {
      const b = program.methods
        .lockSessionCommitment(sessionId, Keypair.generate().publicKey, Keypair.generate().publicKey, new BN(1_000_000), new BN(1_000))
        .accounts({
          oracle: signer ? signer.publicKey : admin.publicKey,
          sessionCommitment: pda(Buffer.from('session_commitment'), Buffer.from(sessionId)),
          systemProgram: SystemProgram.programId,
          programState: programState(),
        });
      return signer ? b.signers([signer]).rpc() : b.rpc();
    };

    const propose = (signer: Keypair | null) => {
      const b = program.methods
        .createProposal(proposalId, Keypair.generate().publicKey, Array.from(Buffer.alloc(32, 7)), new BN(1_000_000))
        .accounts({
          oracle: signer ? signer.publicKey : admin.publicKey,
          proposal: pda(Buffer.from('gov_proposal'), Buffer.from(proposalId)),
          systemProgram: SystemProgram.programId,
          programState: programState(),
        });
      return signer ? b.signers([signer]).rpc() : b.rpc();
    };

    const openDispute = (signer: Keypair | null) => {
      const b = program.methods.openDisputeOnchain(Array.from(Buffer.alloc(32, 9)), new BN(5)).accounts({
        oracle: signer ? signer.publicKey : admin.publicKey,
        escrow: escrowKey,
        disputeRecord: pda(Buffer.from('dispute_record'), escrowKey.toBuffer()),
        systemProgram: SystemProgram.programId,
        programState: programState(),
      });
      return signer ? b.signers([signer]).rpc() : b.rpc();
    };

    const review = (signer: Keypair | null) => {
      const b = program.methods.submitReviewAttestation(escrowKey, reviewer, Array.from(Buffer.alloc(32, 3))).accounts({
        oracle: signer ? signer.publicKey : admin.publicKey,
        reviewAttestation: pda(Buffer.from('review'), escrowKey.toBuffer(), reviewer.toBuffer()),
        systemProgram: SystemProgram.programId,
        programState: programState(),
      });
      return signer ? b.signers([signer]).rpc() : b.rpc();
    };

    const spend = (signer: Keypair | null) => {
      const b = program.methods.logSpendingEvent(Keypair.generate().publicKey, new BN(5), 0).accounts({
        oracle: signer ? signer.publicKey : admin.publicKey,
        programState: programState(),
      });
      return signer ? b.signers([signer]).rpc() : b.rpc();
    };

    it('rejects non-admin signers', async () => {
      await expectDenied('lock_session_commitment', () => lock(attacker), ADDRESS_CONSTRAINT);
      await expectDenied('create_proposal', () => propose(attacker), ADDRESS_CONSTRAINT);
      await expectDenied('open_dispute_onchain', () => openDispute(attacker), ADDRESS_CONSTRAINT);
      await expectDenied('submit_review_attestation', () => review(attacker), ADDRESS_CONSTRAINT);
      await expectDenied('log_spending_event', () => spend(attacker), ADDRESS_CONSTRAINT);
    });

    it('still works for the program admin', async () => {
      await lock(null);
      await propose(null);
      await openDispute(null);
      await review(null);
      await spend(null);
    });
  });
});
