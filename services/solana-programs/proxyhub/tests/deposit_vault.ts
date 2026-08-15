import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";

describe("deposit_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Proxyhub as Program;
  const programAccounts = program.account as any;
  const admin = provider.wallet as anchor.Wallet;

  const hotTreasury = Keypair.generate();
  const stranger = Keypair.generate();
  const wrongDest = Keypair.generate();

  function findProgramState(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("program_state")],
      program.programId
    );
  }

  function findDepositVault(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("deposit_vault")],
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
    await airdrop(admin.publicKey, 20);
    await airdrop(hotTreasury.publicKey, 1);
    await airdrop(stranger.publicKey, 2);
    await airdrop(wrongDest.publicKey, 1);

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

  it("initializes deposit vault bound to hot treasury", async () => {
    const [programStatePda] = findProgramState();
    const [vaultPda] = findDepositVault();

    await program.methods
      .initializeDepositVault(hotTreasury.publicKey, admin.publicKey)
      .accounts({
        depositVault: vaultPda,
        programState: programStatePda,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const vault = await programAccounts.depositVault.fetch(vaultPda);
    expect(vault.authority.toBase58()).to.equal(admin.publicKey.toBase58());
    expect(vault.hotTreasury.toBase58()).to.equal(hotTreasury.publicKey.toBase58());
    expect(vault.totalWithdrawn.toNumber()).to.equal(0);
  });

  it("credits native SOL transfer into the vault PDA", async () => {
    const [vaultPda] = findDepositVault();
    const before = await provider.connection.getBalance(vaultPda);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: stranger.publicKey,
        toPubkey: vaultPda,
        lamports: LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(tx, [stranger]);

    const after = await provider.connection.getBalance(vaultPda);
    expect(after - before).to.equal(LAMPORTS_PER_SOL);
  });

  it("withdraws only to the bound hot treasury", async () => {
    const [programStatePda] = findProgramState();
    const [vaultPda] = findDepositVault();

    const amount = Math.floor(0.5 * LAMPORTS_PER_SOL);
    const hotBefore = await provider.connection.getBalance(hotTreasury.publicKey);

    await program.methods
      .withdrawFromVault(new BN(amount))
      .accounts({
        depositVault: vaultPda,
        hotTreasury: hotTreasury.publicKey,
        programState: programStatePda,
        authority: admin.publicKey,
      })
      .rpc();

    const hotAfter = await provider.connection.getBalance(hotTreasury.publicKey);
    expect(hotAfter - hotBefore).to.equal(amount);

    const vault = await programAccounts.depositVault.fetch(vaultPda);
    expect(vault.totalWithdrawn.toNumber()).to.equal(amount);
  });

  it("rejects withdraw to a non-hot destination", async () => {
    const [programStatePda] = findProgramState();
    const [vaultPda] = findDepositVault();

    let failed = false;
    try {
      await program.methods
        .withdrawFromVault(new BN(1000))
        .accounts({
          depositVault: vaultPda,
          hotTreasury: wrongDest.publicKey,
          programState: programStatePda,
          authority: admin.publicKey,
        })
        .rpc();
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
  });

  it("rejects unauthorized withdraw", async () => {
    const [programStatePda] = findProgramState();
    const [vaultPda] = findDepositVault();

    let failed = false;
    try {
      await program.methods
        .withdrawFromVault(new BN(1000))
        .accounts({
          depositVault: vaultPda,
          hotTreasury: hotTreasury.publicKey,
          programState: programStatePda,
          authority: stranger.publicKey,
        })
        .signers([stranger])
        .rpc();
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
  });

  it("updates hot treasury binding", async () => {
    const [programStatePda] = findProgramState();
    const [vaultPda] = findDepositVault();
    const newHot = Keypair.generate();
    await airdrop(newHot.publicKey, 1);

    await program.methods
      .updateDepositVaultHot(newHot.publicKey)
      .accounts({
        depositVault: vaultPda,
        programState: programStatePda,
        authority: admin.publicKey,
      })
      .rpc();

    const vault = await programAccounts.depositVault.fetch(vaultPda);
    expect(vault.hotTreasury.toBase58()).to.equal(newHot.publicKey.toBase58());
  });
});
