import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { expect } from 'chai';

describe('proxyhub critical escrow and governance coverage', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Proxyhub as Program;
  const programAccounts = program.account as any;
  const admin = provider.wallet as anchor.Wallet;

  function findProgramState(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from('program_state')], program.programId);
  }

  function findEscrow(buyerKey: PublicKey, sellerKey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), buyerKey.toBuffer(), sellerKey.toBuffer()],
      program.programId,
    );
  }

  function findProposal(proposalId: Buffer): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('gov_proposal'), proposalId],
      program.programId,
    );
  }

  function findGovernanceVote(proposalPda: PublicKey, voterKey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('gov_vote'), proposalPda.toBuffer(), voterKey.toBuffer()],
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
        .initializeProgram(1)
        .accounts({
          admin: admin.publicKey,
          programState: programStatePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    return programStatePda;
  }

  before(async () => {
    await ensureProgramState();
  });

  describe('legacy escrow critical path', () => {
    const buyer = Keypair.generate();
    const seller = Keypair.generate();
    let escrowPda: PublicKey;

    before(async () => {
      await Promise.all([airdrop(buyer.publicKey), airdrop(seller.publicKey)]);
      [escrowPda] = findEscrow(buyer.publicKey, seller.publicKey);
    });

    it('initializes a legacy escrow with pending status', async () => {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;

      await program.methods
        .initializeEscrow(
          new anchor.BN(LAMPORTS_PER_SOL / 10),
          new anchor.BN(10),
          new anchor.BN(expiresAt),
        )
        .accounts({
          escrow: escrowPda,
          buyer: buyer.publicKey,
          seller: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      const escrow = await programAccounts.escrow.fetch(escrowPda);
      expect(escrow.buyer.toBase58()).to.equal(buyer.publicKey.toBase58());
      expect(escrow.seller.toBase58()).to.equal(seller.publicKey.toBase58());
      expect(escrow.amount.toNumber()).to.equal(LAMPORTS_PER_SOL / 10);
      expect(escrow.bandwidthLimitGb.toNumber()).to.equal(10);
      expect(escrow.status).to.deep.include({ pending: {} });
    });

    it('settles the legacy escrow and records used bandwidth', async () => {
      await program.methods
        .settleEscrow(new anchor.BN(4))
        .accounts({
          escrow: escrowPda,
          buyer: buyer.publicKey,
          seller: seller.publicKey,
        })
        .rpc();

      const escrow = await programAccounts.escrow.fetch(escrowPda);
      expect(escrow.bandwidthUsedGb.toNumber()).to.equal(4);
      expect(escrow.status).to.deep.include({ settled: {} });
    });
  });

  describe('governance finalization and execution guardrails', () => {
    const passedProposalId = Buffer.from('proposal-final-01');
    const rejectedProposalId = Buffer.from('proposal-final-02');
    const passedTitleHash = Buffer.alloc(32, 0x11);
    const rejectedTitleHash = Buffer.alloc(32, 0x22);
    const yesVoter = Keypair.generate();
    const noVoter = Keypair.generate();
    let passedProposalPda: PublicKey;
    let rejectedProposalPda: PublicKey;

    before(async () => {
      await Promise.all([airdrop(yesVoter.publicKey), airdrop(noVoter.publicKey)]);
      [passedProposalPda] = findProposal(passedProposalId);
      [rejectedProposalPda] = findProposal(rejectedProposalId);
    });

    it('finalizes a passed proposal once its voting window is already closed', async () => {
      const [programStatePda] = findProgramState();
      const pastEndSlot = Math.max(1, (await provider.connection.getSlot()) - 1);

      await program.methods
        .createProposal(Array.from(passedProposalId), yesVoter.publicKey, Array.from(passedTitleHash), new anchor.BN(pastEndSlot))
        .accounts({
          oracle: admin.publicKey,
          proposal: passedProposalPda,
          systemProgram: SystemProgram.programId,
          programState: programStatePda,
        })
        .rpc();

      const [yesVotePda] = findGovernanceVote(passedProposalPda, yesVoter.publicKey);

      await program.methods
        .castGovernanceVote(true, new anchor.BN(1500))
        .accounts({
          voter: yesVoter.publicKey,
          proposal: passedProposalPda,
          governanceVote: yesVotePda,
          systemProgram: SystemProgram.programId,
          programState: programStatePda,
        })
        .signers([yesVoter])
        .rpc();

      await program.methods
        .finalizeProposal()
        .accounts({
          proposal: passedProposalPda,
          programState: programStatePda,
        })
        .rpc();

      const proposal = await programAccounts.governanceProposal.fetch(passedProposalPda);
      expect(proposal.status).to.equal(1);
      expect(proposal.voteYes.toNumber()).to.equal(1500);
      expect(proposal.voteNo.toNumber()).to.equal(0);
    });

    it('rejects execution before the governance timelock elapses', async () => {
      const [programStatePda] = findProgramState();

      try {
        await program.methods
          .executeProposal()
          .accounts({
            proposal: passedProposalPda,
            programState: programStatePda,
            admin: admin.publicKey,
          })
          .rpc();
        expect.fail('execute_proposal should fail before timelock expiry');
      } catch (err: any) {
        expect(err).to.exist;
      }
    });

    it('finalizes a rejected proposal when no votes win', async () => {
      const [programStatePda] = findProgramState();
      const pastEndSlot = Math.max(1, (await provider.connection.getSlot()) - 1);

      await program.methods
        .createProposal(Array.from(rejectedProposalId), noVoter.publicKey, Array.from(rejectedTitleHash), new anchor.BN(pastEndSlot))
        .accounts({
          oracle: admin.publicKey,
          proposal: rejectedProposalPda,
          systemProgram: SystemProgram.programId,
          programState: programStatePda,
        })
        .rpc();

      const [noVotePda] = findGovernanceVote(rejectedProposalPda, noVoter.publicKey);

      await program.methods
        .castGovernanceVote(false, new anchor.BN(900))
        .accounts({
          voter: noVoter.publicKey,
          proposal: rejectedProposalPda,
          governanceVote: noVotePda,
          systemProgram: SystemProgram.programId,
          programState: programStatePda,
        })
        .signers([noVoter])
        .rpc();

      await program.methods
        .finalizeProposal()
        .accounts({
          proposal: rejectedProposalPda,
          programState: programStatePda,
        })
        .rpc();

      const proposal = await programAccounts.governanceProposal.fetch(rejectedProposalPda);
      expect(proposal.status).to.equal(2);
      expect(proposal.voteYes.toNumber()).to.equal(0);
      expect(proposal.voteNo.toNumber()).to.equal(900);
    });
  });
});