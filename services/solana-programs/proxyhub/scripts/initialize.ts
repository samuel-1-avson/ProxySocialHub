import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Proxyhub } from "../target/types/proxyhub";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// Load deployment keypair
function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

async function main() {
  // Configure the client to use devnet
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Proxyhub as Program<Proxyhub>;
  
  console.log("Program ID:", program.programId.toString());
  console.log("Deployer:", provider.wallet.publicKey.toString());

  // ============================================================
  // INITIALIZE PROGRAM STATE
  // ============================================================
  
  console.log("\n=== Initializing Program State ===");
  
  const [programStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("program_state")],
    program.programId
  );
  
  try {
    await program.methods
      .initializeProgram(3) // min_oracle_signatures = 3
      .accounts({
        programState: programStatePDA,
        admin: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log("✅ Program state initialized");
    console.log("   PDA:", programStatePDA.toString());
  } catch (e) {
    if (e.toString().includes("already in use")) {
      console.log("ℹ️  Program state already initialized");
    } else {
      throw e;
    }
  }

  // ============================================================
  // INITIALIZE MULTI-SIG ORACLE
  // ============================================================
  
  console.log("\n=== Initializing Multi-Sig Oracle ===");
  
  // Load or generate 5 oracle signers
  // In production, these would be separate HSMs run by different entities
  const oracleSigners: Keypair[] = [];
  const signerDir = path.join(__dirname, "../oracle-signers");
  
  if (!fs.existsSync(signerDir)) {
    fs.mkdirSync(signerDir, { recursive: true });
  }
  
  for (let i = 0; i < 5; i++) {
    const signerPath = path.join(signerDir, `signer-${i}.json`);
    if (fs.existsSync(signerPath)) {
      oracleSigners.push(loadKeypair(signerPath));
      console.log(`   Loaded signer ${i}: ${oracleSigners[i].publicKey.toString().slice(0, 20)}...`);
    } else {
      const newSigner = Keypair.generate();
      fs.writeFileSync(signerPath, JSON.stringify(Array.from(newSigner.secretKey)));
      oracleSigners.push(newSigner);
      console.log(`   Generated signer ${i}: ${newSigner.publicKey.toString().slice(0, 20)}...`);
    }
  }
  
  const [multiSigPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("multisig_oracle")],
    program.programId
  );
  
  const signerPubkeys = oracleSigners.map(s => s.publicKey);
  
  try {
    await program.methods
      .initializeMultisigOracle(signerPubkeys, 3) // threshold = 3 of 5
      .accounts({
        multisigOracle: multiSigPDA,
        admin: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log("✅ Multi-sig oracle initialized");
    console.log("   PDA:", multiSigPDA.toString());
    console.log("   Signers:", signerPubkeys.length);
    console.log("   Threshold: 3 of 5");
  } catch (e) {
    if (e.toString().includes("already in use")) {
      console.log("ℹ️  Multi-sig oracle already initialized");
    } else {
      throw e;
    }
  }

  // ============================================================
  // INITIALIZE INSURANCE POOL
  // ============================================================
  
  console.log("\n=== Initializing Insurance Pool ===");
  
  const [insurancePoolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_pool")],
    program.programId
  );
  
  try {
    await program.methods
      .initializeInsurancePool()
      .accounts({
        insurancePool: insurancePoolPDA,
        admin: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log("✅ Insurance pool initialized");
    console.log("   PDA:", insurancePoolPDA.toString());
  } catch (e) {
    if (e.toString().includes("already in use")) {
      console.log("ℹ️  Insurance pool already initialized");
    } else {
      throw e;
    }
  }

  // ============================================================
  // INITIALIZE PRICE ORACLE
  // ============================================================
  
  console.log("\n=== Initializing Price Oracle ===");
  
  const [priceOraclePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("price_oracle")],
    program.programId
  );
  
  // Initial prices (in lamports per GB)
  // 0.001 SOL = 1,000,000 lamports
  const residentialPrice = new anchor.BN(1_000_000);      // 0.001 SOL
  const datacenterPrice = new anchor.BN(500_000);         // 0.0005 SOL
  const mobilePrice = new anchor.BN(1_500_000);           // 0.0015 SOL
  
  try {
    await program.methods
      .initializePriceOracle(residentialPrice, datacenterPrice, mobilePrice)
      .accounts({
        priceOracle: priceOraclePDA,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log("✅ Price oracle initialized");
    console.log("   PDA:", priceOraclePDA.toString());
    console.log("   Residential:", residentialPrice.toString(), "lamports/GB");
    console.log("   Datacenter:", datacenterPrice.toString(), "lamports/GB");
    console.log("   Mobile:", mobilePrice.toString(), "lamports/GB");
  } catch (e) {
    if (e.toString().includes("already in use")) {
      console.log("ℹ️  Price oracle already initialized");
    } else {
      throw e;
    }
  }

  // ============================================================
  // SAVE CONFIGURATION
  // ============================================================
  
  console.log("\n=== Saving Configuration ===");
  
  const config = {
    network: "devnet",
    programId: program.programId.toString(),
    programState: programStatePDA.toString(),
    multiSigOracle: multiSigPDA.toString(),
    insurancePool: insurancePoolPDA.toString(),
    priceOracle: priceOraclePDA.toString(),
    oracleSigners: signerPubkeys.map(p => p.toString()),
    threshold: 3,
    deployedAt: new Date().toISOString(),
  };
  
  const configPath = path.join(__dirname, "../deployment-config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  console.log("✅ Configuration saved to:", configPath);
  
  // ============================================================
  // SUMMARY
  // ============================================================
  
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║          INITIALIZATION COMPLETE (DevNet)               ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║ Program ID:", program.programId.toString().padEnd(47), "║");
  console.log("║ Multi-Sig: 3 of 5 threshold                             ║");
  console.log("║ Emergency Pause: Enabled                                ║");
  console.log("║ Insurance Pool: Active                                  ║");
  console.log("║ Dynamic Pricing: Enabled                                ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  
  console.log("\nNext steps:");
  console.log("1. Fund the oracle signers with SOL for transaction fees");
  console.log("2. Configure the Go backend with the new PDA addresses");
  console.log("3. Test multi-sig settlement with 3+ signers");
  console.log("4. Verify emergency pause functionality");
}

main().catch((error) => {
  console.error("❌ Initialization failed:", error);
  process.exit(1);
});
