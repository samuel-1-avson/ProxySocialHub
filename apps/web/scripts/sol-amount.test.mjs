import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSolAmountLamports} from '../src/lib/sol-amount.ts';
test('SOL input converts exactly to integer lamports',()=>{
  assert.equal(parseSolAmountLamports('0.000000001'),1);
  assert.equal(parseSolAmountLamports('1.000000001'),1_000_000_001);
  assert.equal(parseSolAmountLamports('0.29'),290_000_000);
  assert.equal(parseSolAmountLamports(' 12.345678901 '),12_345_678_901);
});
test('rejects fractional lamports and ambiguous numeric syntax',()=>{
  for(const value of ['0.0000000001','-1','1e9','Infinity','NaN','','.1','1.','1,2'])assert.equal(parseSolAmountLamports(value),null,value);
});
test('stays within safe JSON API integer precision',()=>{
  assert.equal(parseSolAmountLamports('9007199.254740991'),Number.MAX_SAFE_INTEGER);
  assert.equal(parseSolAmountLamports('9007199.254740992'),null);
});
