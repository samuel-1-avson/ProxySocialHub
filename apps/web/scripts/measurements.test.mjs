import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Match the app's TypeScript compilation while supporting the web CI's Node 20.
const source = readFileSync(new URL('../src/lib/measurements.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { measurement, measured, meanMeasurements, sumMeasurements } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('absent or malformed measurements never become zero', () => {
  for (const value of [undefined, null, '', '  ', false, true, {}, NaN, Infinity, 'unknown']) {
    assert.equal(measurement(value), undefined);
    assert.equal(measured(value), 'Not reported');
  }
  assert.equal(measurement(0), 0);
  assert.equal(measurement('0'), 0);
  assert.equal(measured('1.25', 2, 'SOL'), '1.25 SOL');
});

test('averages exclude missing samples and totals reject partial measurements', () => {
  assert.equal(meanMeasurements([0, 100, null]), 50);
  assert.equal(meanMeasurements([null, undefined]), undefined);
  assert.equal(sumMeasurements([1, '2', 0]), 3);
  assert.equal(sumMeasurements([1, undefined]), undefined);
  assert.equal(sumMeasurements([]), 0);
});
