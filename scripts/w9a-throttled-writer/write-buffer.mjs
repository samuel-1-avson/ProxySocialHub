#!/usr/bin/env node
/**
 * Throttled BPF-upgradeable write-buffer for Wave 9.A.
 * One Write ix per tx against public (or any) RPC. Never programs/session.
 *
 *   node write-buffer.mjs --rpc URL --so PATH --payer KP.json --buffer-kp KP.json
 */
import fs from "node:fs";
import pkg from "@solana/web3.js";
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = pkg;
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

const SESSION = "8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb";
const BUFFER_META = 37;
const CHUNK = 800;
const SLEEP_MS = Number(process.env.W9A_SLEEP_MS || 500);
const CONFIRM_EVERY = 12;

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function loadKp(p) {
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function writeIx(buffer, authority, offset, bytes) {
  const data = Buffer.alloc(16 + bytes.length);
  data.writeUInt32LE(1, 0);
  data.writeUInt32LE(offset, 4);
  data.writeBigUInt64LE(BigInt(bytes.length), 8);
  Buffer.from(bytes).copy(data, 16);
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function initBufferIx(buffer, authority) {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(0, 0);
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function sendWithRetry(connection, buildTx, signers, label) {
  let lastErr;
  for (let i = 0; i < 12; i++) {
    const tx = buildTx();
    try {
      const sig = await sendAndConfirmTransaction(connection, tx, signers, {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
        maxRetries: 0,
      });
      return sig;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const retryable =
        /429|Too Many|blockhash|expired|timeout|ECONNRESET|fetch failed|503|502|rate|Node is behind/i.test(
          msg
        );
      console.log(`retry ${label} attempt=${i + 1} retryable=${retryable} err=${msg.slice(0, 180)}`);
      if (!retryable && /custom program error|invalid account/i.test(msg) && i >= 2) {
        throw e;
      }
      await sleep(Math.min(15000, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function main() {
  const rpc = arg("rpc", "https://api.devnet.solana.com");
  const soPath = arg("so");
  const payerPath = arg("payer");
  const bufferPath = arg("buffer-kp");
  const programId = arg("program-id", "AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu");
  if (!soPath || !payerPath || !bufferPath) {
    throw new Error("need --so --payer --buffer-kp");
  }
  if (programId === SESSION) {
    throw new Error("REFUSE: programs/session");
  }

  const so = fs.readFileSync(soPath);
  const payer = loadKp(payerPath);
  let bufferKp;
  if (fs.existsSync(bufferPath)) {
    bufferKp = loadKp(bufferPath);
  } else {
    bufferKp = Keypair.generate();
    fs.writeFileSync(bufferPath, JSON.stringify(Array.from(bufferKp.secretKey)));
  }

  const progressPath = bufferPath + ".progress.json";
  let offset = 0;
  if (fs.existsSync(progressPath)) {
    const p = JSON.parse(fs.readFileSync(progressPath, "utf8"));
    if (p.buffer === bufferKp.publicKey.toBase58()) offset = Number(p.offset) || 0;
  }

  const connection = new Connection(rpc, { commitment: "confirmed" });
  const slot = await connection.getSlot("confirmed");
  console.log(`rpc_slot=${slot}`);
  console.log(`so_size=${so.length}`);
  console.log(`buffer=${bufferKp.publicKey.toBase58()}`);
  console.log(`payer=${payer.publicKey.toBase58()}`);
  console.log(`resume_offset=${offset}`);
  console.log(`chunk=${CHUNK} sleep_ms=${SLEEP_MS}`);

  const info = await connection.getAccountInfo(bufferKp.publicKey, "confirmed");
  if (!info) {
    const space = BUFFER_META + so.length;
    const lamports = await connection.getMinimumBalanceForRentExemption(space);
    console.log(`create_buffer space=${space} lamports=${lamports}`);
    const sig = await sendWithRetry(
      connection,
      () =>
        new Transaction().add(
          SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: bufferKp.publicKey,
            lamports,
            space,
            programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
          }),
          initBufferIx(bufferKp.publicKey, payer.publicKey)
        ),
      [payer, bufferKp],
      "create_buffer"
    );
    console.log(`create_buffer_sig=${sig}`);
    offset = 0;
  } else {
    console.log(`buffer_exists len=${info.data.length} owner=${info.owner.toBase58()}`);
  }

  const total = so.length;
  let sent = 0;
  while (offset < total) {
    const end = Math.min(offset + CHUNK, total);
    const chunk = so.subarray(offset, end);
    const at = offset;
    const sig = await sendWithRetry(
      connection,
      () => new Transaction().add(writeIx(bufferKp.publicKey, payer.publicKey, at, chunk)),
      [payer],
      `write_${at}_${end}`
    );
    sent += 1;
    offset = end;
    fs.writeFileSync(
      progressPath,
      JSON.stringify({ buffer: bufferKp.publicKey.toBase58(), offset, total })
    );
    if (sent % CONFIRM_EVERY === 0 || offset === total) {
      const pct = ((offset / total) * 100).toFixed(1);
      console.log(`progress ${offset}/${total} (${pct}%) last=${sig}`);
    }
    await sleep(SLEEP_MS);
  }

  console.log(`BUFFER_PUBKEY=${bufferKp.publicKey.toBase58()}`);
  console.log("WRITE_BUFFER_OK");
}

main().catch((e) => {
  console.error("WRITE_BUFFER_FAIL", e?.message || e);
  process.exit(1);
});
