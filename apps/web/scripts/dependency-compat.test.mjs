import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { Connection, Keypair, SystemProgram } from '@solana/web3.js';

const source = new URL('../src/lib/solana.ts', import.meta.url);
const require = createRequire(source);
const anchor = require('@project-serum/anchor');
const output = ts.transpileModule(readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const exports = {};
vm.runInNewContext(output, { exports, require, process, Buffer, console }, { filename: source.pathname });

test('patched TOML parser retains Anchor workspace configuration values', () => {
  const anchorRequire = createRequire(require.resolve('@project-serum/anchor'));
  const toml = anchorRequire('toml');
  const result = toml.parse('[provider]\ncluster = "devnet"\nwallet = "test-wallet.json"\n[features]\nseeds = true\n');
  assert.equal(result.provider.cluster, 'devnet');
  assert.equal(result.provider.wallet, 'test-wallet.json');
  assert.equal(result.features.seeds, true);
});

test('Solana escrow instruction keeps lamports, micro-GiB, expiry, and signer accounts', async () => {
  const buyer = Keypair.generate();
  const seller = Keypair.generate().publicKey;
  const program = exports.getProgram({ publicKey: buyer.publicKey });
  const escrow = new (require('@solana/web3.js').PublicKey)(exports.deriveEscrowPDA(buyer.publicKey.toBase58(), seller.toBase58()).pda);
  const amount = 1_234_567;
  const bandwidth = exports.escrowBandwidthUnitsFromGiB(0.125);
  const expiry = 1_900_000_000;
  const instruction = await program.methods.initializeEscrow(
    new anchor.BN(amount), new anchor.BN(bandwidth), new anchor.BN(expiry),
  ).accounts({ escrow, buyer: buyer.publicKey, seller, systemProgram: SystemProgram.programId }).instruction();
  assert.equal(instruction.data.length, 32);
  assert.deepEqual(instruction.data.subarray(0, 8), createHash('sha256').update('global:initialize_escrow').digest().subarray(0, 8));
  assert.equal(instruction.data.readBigUInt64LE(8), 1_234_567n);
  assert.equal(instruction.data.readBigUInt64LE(16), 125_000n);
  assert.equal(instruction.data.readBigInt64LE(24), 1_900_000_000n);
  assert.deepEqual(instruction.keys.map(key => [key.pubkey.toBase58(), key.isSigner, key.isWritable]), [
    [escrow.toBase58(), false, true], [buyer.publicKey.toBase58(), true, true],
    [seller.toBase58(), false, false], [SystemProgram.programId.toBase58(), false, false],
  ]);
});

test('Solana JSON-RPC client retains valid, distinct UUID request IDs', async () => {
  const seen = [];
  const connection = new Connection('https://rpc.example.invalid', {
    fetch: async (_url, init) => {
      const request = JSON.parse(init.body);
      seen.push(request);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { context: { slot: 42 }, value: 123 } }), { status: 200 });
    },
  });
  const key = Keypair.generate().publicKey;
  assert.equal(await connection.getBalance(key), 123);
  assert.equal(await connection.getBalance(key), 123);
  assert.notEqual(seen[0].id, seen[1].id);
  for (const request of seen) {
    assert.match(request.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(request.method, 'getBalance');
    assert.equal(request.params[0], key.toBase58());
  }
});
