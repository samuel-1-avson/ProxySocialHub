/**
 * BC-06 smoke: init escrow_multisig + dual-sign settle + assert nonce bump.
 * Uses admin/oracle keypair as fee payer and as buyer for a small escrow.
 */
import anchor from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Ed25519Program,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');
const PROGRAM_ID = new PublicKey('AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu');
const RPC = process.env.RPC || 'https://api.devnet.solana.com';

function loadKp(p) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
}

const admin = loadKp(process.env.ADMIN_KP || path.join(root, 'infra/oracle-keypair.json'));
const cosigner = loadKp(
  process.env.COSIGNER_KP || path.join(root, 'secrets/multisig-cosigner.json')
);
const seller = Keypair.generate();

const connection = new Connection(RPC, 'confirmed');
const wallet = new anchor.Wallet(admin);
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
anchor.setProvider(provider);
const idl = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../target/idl/proxyhub.json'), 'utf8')
);
const program = new anchor.Program(idl, provider);
const BN = anchor.BN;

const [msoPda] = PublicKey.findProgramAddressSync([Buffer.from('multisig_oracle')], PROGRAM_ID);
const [programStatePda] = PublicKey.findProgramAddressSync(
  [Buffer.from('program_state')],
  PROGRAM_ID
);
const [priceOraclePda] = PublicKey.findProgramAddressSync(
  [Buffer.from('price_oracle')],
  PROGRAM_ID
);

const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const ts = Buffer.alloc(8);
ts.writeBigInt64LE(BigInt(expiresAt));
const [escrowPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('escrow_multisig'), admin.publicKey.toBuffer(), seller.publicKey.toBuffer(), ts],
  PROGRAM_ID
);

const amount = new BN(Math.floor(0.02 * LAMPORTS_PER_SOL));
const limitGb = new BN(10);

console.log('escrow', escrowPda.toBase58());
console.log('expiresAt', expiresAt);

await connection.requestAirdrop(seller.publicKey, 0.05 * LAMPORTS_PER_SOL).catch(() => {});

const before = await program.account.multiSigOracle.fetch(msoPda);
const nonceBefore = before.nonce.toNumber();
console.log('nonce_before', nonceBefore);

await program.methods
  .initializeEscrowMultisig(amount, limitGb, new BN(expiresAt))
  .accounts({
    escrow: escrowPda,
    buyer: admin.publicKey,
    seller: seller.publicKey,
    programState: programStatePda,
    priceOracle: priceOraclePda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
console.log('init_ok');

const usage = 10;
const msg = Buffer.from(
  `settle:${escrowPda.toBase58()}:${admin.publicKey.toBase58()}:${seller.publicKey.toBase58()}:${usage}:${nonceBefore}`
);
const ed1 = Ed25519Program.createInstructionWithPrivateKey({
  privateKey: admin.secretKey,
  message: msg,
});
const ed2 = Ed25519Program.createInstructionWithPrivateKey({
  privateKey: cosigner.secretKey,
  message: msg,
});

const nonceBuf = Buffer.alloc(8);
nonceBuf.writeBigUInt64LE(BigInt(nonceBefore));
const [oracleSigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('oracle_sig'), escrowPda.toBuffer(), nonceBuf],
  PROGRAM_ID
);

const settleSig = await program.methods
  .settleEscrowMultisig(new BN(usage), [admin.publicKey, cosigner.publicKey])
  .accounts({
    escrow: escrowPda,
    buyer: admin.publicKey,
    seller: seller.publicKey,
    multisigOracle: msoPda,
    oracleSignature: oracleSigPda,
    payer: admin.publicKey,
    programState: programStatePda,
    systemProgram: SystemProgram.programId,
    instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
  })
  .preInstructions([ed1, ed2])
  .rpc();

const after = await program.account.multiSigOracle.fetch(msoPda);
const escrow = await program.account.escrow.fetch(escrowPda);
console.log('settle_sig', settleSig);
console.log('nonce_after', after.nonce.toNumber());
console.log('escrow_status', escrow.status);
if (after.nonce.toNumber() !== nonceBefore + 1) {
  throw new Error(`nonce not bumped: ${nonceBefore} -> ${after.nonce.toNumber()}`);
}
console.log('BC06_SMOKE_SETTLE_OK');
