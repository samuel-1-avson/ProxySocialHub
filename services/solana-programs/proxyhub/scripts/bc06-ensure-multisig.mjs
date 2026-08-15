import anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');
const PROGRAM_ID = new PublicKey(
  process.env.SOLANA_PROGRAM_ID || 'AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu'
);
const RPC = process.env.RPC || 'https://api.devnet.solana.com';

function loadKp(p) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
}

const adminPath = process.env.ADMIN_KP || path.join(root, 'infra/oracle-keypair.json');
const cosignerPath =
  process.env.COSIGNER_KP || path.join(root, 'secrets/multisig-cosigner.json');
const oraclePub = new PublicKey(
  process.env.ORACLE_PUB || '8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2'
);

if (!fs.existsSync(cosignerPath)) {
  fs.mkdirSync(path.dirname(cosignerPath), { recursive: true });
  const fresh = Keypair.generate();
  fs.writeFileSync(cosignerPath, JSON.stringify(Array.from(fresh.secretKey)));
  console.log('generated_cosigner', fresh.publicKey.toBase58());
}

const admin = loadKp(adminPath);
const cosigner = loadKp(cosignerPath);
console.log('admin', admin.publicKey.toBase58());
console.log('oracle', oraclePub.toBase58());
console.log('cosigner', cosigner.publicKey.toBase58());

const connection = new Connection(RPC, 'confirmed');
const wallet = new anchor.Wallet(admin);
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
anchor.setProvider(provider);

const idlPath =
  process.env.IDL_PATH || path.join(__dirname, '../target/idl/proxyhub.json');
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
// Anchor 0.32+: Program(idl, provider) — address comes from idl.address
const program = new anchor.Program(idl, provider);

const [msoPda] = PublicKey.findProgramAddressSync([Buffer.from('multisig_oracle')], PROGRAM_ID);
const [programStatePda] = PublicKey.findProgramAddressSync(
  [Buffer.from('program_state')],
  PROGRAM_ID
);
const [priceOraclePda] = PublicKey.findProgramAddressSync(
  [Buffer.from('price_oracle')],
  PROGRAM_ID
);

const desired = [oraclePub, cosigner.publicKey];
const info = await connection.getAccountInfo(msoPda);

if (!info) {
  console.log('initializing multisig_oracle threshold=2');
  const sig = await program.methods
    .initializeMultisigOracle(desired, 2)
    .accounts({
      multisigOracle: msoPda,
      admin: admin.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log('init_sig', sig);
} else {
  const mso = await program.account.multiSigOracle.fetch(msoPda);
  console.log('current_threshold', mso.threshold);
  console.log(
    'current_signers',
    mso.signers.map((s) => s.toBase58())
  );
  const have = new Set(mso.signers.map((s) => s.toBase58()));
  for (const pk of desired) {
    if (!have.has(pk.toBase58())) {
      console.log('add_oracle_signer', pk.toBase58());
      await program.methods
        .addOracleSigner(pk)
        .accounts({
          multisigOracle: msoPda,
          admin: admin.publicKey,
          programState: programStatePda,
        })
        .rpc();
    }
  }
  if (mso.threshold !== 2) {
    console.log('update_threshold -> 2');
    await program.methods
      .updateThreshold(2)
      .accounts({
        multisigOracle: msoPda,
        admin: admin.publicKey,
        programState: programStatePda,
      })
      .rpc();
  }
}

const priceInfo = await connection.getAccountInfo(priceOraclePda);
if (!priceInfo) {
  console.log('initializing price_oracle');
  const BN = anchor.BN;
  const sig = await program.methods
    .initializePriceOracle(new BN(1), new BN(1), new BN(1))
    .accounts({
      priceOracle: priceOraclePda,
      authority: admin.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log('price_oracle_sig', sig);
} else {
  console.log('price_oracle_exists', priceOraclePda.toBase58());
}

const after = await program.account.multiSigOracle.fetch(msoPda);
console.log('final_threshold', after.threshold);
console.log(
  'final_signers',
  after.signers.map((s) => s.toBase58())
);
console.log('final_nonce', after.nonce.toString());
console.log('BC06_MULTISIG_ORACLE_OK');
