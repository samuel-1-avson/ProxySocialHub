/**
 * One-time ops script (CLOSE01): close terminal legacy escrow accounts
 * (status Settled/Refunded) so their buyer+seller PDAs are freed for
 * re-initialization. Rent reserve is returned to the buyer on-chain.
 *
 * Run on the VM (oracle keypair never leaves the host):
 *   docker run --rm -v /opt/proxyhubb/scripts/ops/close-terminal-escrows:/work \
 *     -w /work node:20-slim bash -lc "npm install --no-audit --no-fund && \
 *     ORACLE_KEYPAIR=/secrets/oracle-keypair.json node close-terminal-escrows.js"
 *
 * Env:
 *   RPC_URL          — devnet RPC (default https://api.devnet.solana.com)
 *   ORACLE_KEYPAIR   — path to oracle/admin keypair JSON (authority)
 *   PROGRAM_ID       — proxyhub program (default AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu)
 *   DRY_RUN=1        — list terminal escrows without closing
 */
const crypto = require('crypto');

const RPC = process.env.RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.PROGRAM_ID || 'AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu';
const KEYPAIR_PATH = process.env.ORACLE_KEYPAIR || '/secrets/oracle-keypair.json';
const DRY_RUN = process.env.DRY_RUN === '1';

const ESCROW_LEN = 154; // Escrow::LEN
// disc(8) + buyer(32) + seller(32) + amount(8) + bw_limit(8) + bw_used(8)
const STATUS_OFFSET = 8 + 32 + 32 + 8 + 8 + 8;
const TERMINAL = new Set([2, 3]); // Settled, Refunded

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function main() {
  const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');

  const secret = JSON.parse(require('fs').readFileSync(KEYPAIR_PATH, 'utf8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(secret));
  const programId = new PublicKey(PROGRAM_ID);
  const connection = new Connection(RPC, 'confirmed');

  const escrowDisc = sha256('account:Escrow').subarray(0, 8);
  const closeDisc = sha256('global:close_escrow').subarray(0, 8);

  const [programState] = PublicKey.findProgramAddressSync([Buffer.from('program_state')], programId);

  console.log('authority:', authority.publicKey.toBase58());
  console.log('program_state:', programState.toBase58());

  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { dataSize: ESCROW_LEN },
      { memcmp: { offset: 0, bytes: require('bs58').encode(escrowDisc) } },
    ],
  });
  console.log(`found ${accounts.length} legacy escrow account(s)`);

  let closed = 0;
  for (const { pubkey, account } of accounts) {
    const data = account.data;
    const status = data[STATUS_OFFSET];
    const buyer = new PublicKey(data.subarray(8, 40));
    const seller = new PublicKey(data.subarray(40, 72));
    const label = `escrow=${pubkey.toBase58()} buyer=${buyer.toBase58()} seller=${seller.toBase58()} status=${status}`;
    if (!TERMINAL.has(status)) {
      console.log(`SKIP (non-terminal): ${label}`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`DRY-RUN would close: ${label}`);
      continue;
    }

    // Multisig escrows share the Escrow layout but use different PDA seeds
    // (they include expires_at, so they never collide). close_escrow only
    // targets the legacy buyer+seller PDA — skip anything else.
    const [legacyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), buyer.toBuffer(), seller.toBuffer()],
      programId,
    );
    if (!legacyPda.equals(pubkey)) {
      console.log(`SKIP (non-legacy PDA, likely multisig): ${label}`);
      continue;
    }

    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: false },
        { pubkey, isSigner: false, isWritable: true },
        { pubkey: buyer, isSigner: false, isWritable: true },
        { pubkey: programState, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(closeDisc),
    });

    const tx = new Transaction().add(ix);
    try {
      const sig = await connection.sendTransaction(tx, [authority], { preflightCommitment: 'confirmed' });
      await connection.confirmTransaction(sig, 'confirmed');
      const after = await connection.getAccountInfo(pubkey);
      console.log(`CLOSED: ${label} tx=${sig} accountGone=${after === null}`);
      closed++;
    } catch (err) {
      console.error(`FAILED: ${label} — ${err.message}`);
    }
  }
  console.log(`done. closed=${closed} dryRun=${DRY_RUN}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
