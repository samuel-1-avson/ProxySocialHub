/**
 * Ensure on-chain multisig_oracle has threshold=2 and includes oracle + cosigner.
 *
 * Usage:
 *   ADMIN_KP=infra/oracle-keypair.json \
 *   COSIGNER_KP=secrets/multisig-cosigner.json \
 *   ORACLE_PUB=8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2 \
 *   npx ts-node scripts/bc06-ensure-multisig-oracle.ts
 */
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const PROGRAM_ID = new PublicKey(
  process.env.SOLANA_PROGRAM_ID || 'AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu'
);
const RPC = process.env.RPC || 'https://api.devnet.solana.com';

function loadKp(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const adminPath = process.env.ADMIN_KP || 'infra/oracle-keypair.json';
  const cosignerPath =
    process.env.COSIGNER_KP || 'secrets/multisig-cosigner.json';
  const oraclePub = new PublicKey(
    process.env.ORACLE_PUB || '8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2'
  );

  if (!fs.existsSync(cosignerPath)) {
    const dir = path.dirname(cosignerPath);
    fs.mkdirSync(dir, { recursive: true });
    const fresh = Keypair.generate();
    fs.writeFileSync(cosignerPath, JSON.stringify(Array.from(fresh.secretKey)));
    console.log('generated_cosigner', fresh.publicKey.toBase58(), '->', cosignerPath);
  }

  const admin = loadKp(adminPath);
  const cosigner = loadKp(cosignerPath);
  console.log('admin', admin.publicKey.toBase58());
  console.log('oracle', oraclePub.toBase58());
  console.log('cosigner', cosigner.publicKey.toBase58());

  const connection = new Connection(RPC, 'confirmed');
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });
  anchor.setProvider(provider);

  const idlPath =
    process.env.IDL_PATH ||
    'services/solana-programs/proxyhub/target/idl/proxyhub.json';
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL missing at ${idlPath}; run anchor build first`);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  const program = new Program(idl, PROGRAM_ID, provider);

  const [msoPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('multisig_oracle')],
    PROGRAM_ID
  );
  const [programStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('program_state')],
    PROGRAM_ID
  );

  const info = await connection.getAccountInfo(msoPda);
  const desired = [oraclePub, cosigner.publicKey];

  if (!info) {
    console.log('initializing multisig_oracle threshold=2');
    await program.methods
      .initializeMultisigOracle(desired, 2)
      .accounts({
        multisigOracle: msoPda,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } else {
    const mso: any = await (program.account as any).multiSigOracle.fetch(msoPda);
    console.log('current_threshold', mso.threshold);
    console.log(
      'current_signers',
      mso.signers.map((s: PublicKey) => s.toBase58())
    );
    const have = new Set(mso.signers.map((s: PublicKey) => s.toBase58()));
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

  const after: any = await (program.account as any).multiSigOracle.fetch(msoPda);
  console.log('final_threshold', after.threshold);
  console.log(
    'final_signers',
    after.signers.map((s: PublicKey) => s.toBase58())
  );
  console.log('final_nonce', after.nonce.toString());
  console.log('BC06_MULTISIG_ORACLE_OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
