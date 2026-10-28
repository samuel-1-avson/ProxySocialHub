import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measurement, measured, meanMeasurements, sumMeasurements } from '../src/lib/measurements.ts';

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
