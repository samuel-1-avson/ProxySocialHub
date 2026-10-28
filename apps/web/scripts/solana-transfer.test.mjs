import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {sendSolTransfer, SolTransferFailedError} from '../src/lib/solana-transfer.ts';
const buyer = Keypair.generate();
const destination = Keypair.generate().publicKey;
test('retains the submitted signature before an RPC confirmation timeout', async () => {
  const seen = [];
  const connection = { confirmTransaction: async () => { seen.push('confirm'); throw new Error('RPC timeout'); } };
  const wallet = { publicKey: buyer.publicKey, sendTransaction: async () => 'original-signature' };
  await assert.rejects(sendSolTransfer(connection, wallet, destination, 1, signature => seen.push(signature)), /RPC timeout/);
  assert.deepEqual(seen, ['original-signature', 'confirm']);
});
test('rejects an on-chain failure instead of reporting a confirmed payment', async () => {
  const connection = { confirmTransaction: async () => ({ value: { err: { InstructionError: [0, 'InsufficientFunds'] } } }) };
  const wallet = { publicKey: buyer.publicKey, sendTransaction: async () => 'failed-signature' };
  await assert.rejects(sendSolTransfer(connection, wallet, destination, 1), error => error instanceof SolTransferFailedError && error.signature === 'failed-signature');
});
test('retains the signature on the raw signed transaction path', async () => {
  const seen = [];
  const connection = {
    getLatestBlockhash: async () => ({blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100}),
    sendRawTransaction: async () => 'raw-signature',
    confirmTransaction: async () => {seen.push('confirm'); return {value: {err: null}};},
  };
  const wallet = {publicKey: buyer.publicKey, signTransaction: async tx => {tx.sign(buyer); return tx;}};
  assert.equal(await sendSolTransfer(connection, wallet, destination, 1, signature => seen.push(signature)), 'raw-signature');
  assert.deepEqual(seen, ['raw-signature', 'confirm']);
});
test('rejects invalid lamports before requesting a wallet signature', async () => {
  for (const amount of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(sendSolTransfer({}, {publicKey: buyer.publicKey}, destination, amount));
  }
});
