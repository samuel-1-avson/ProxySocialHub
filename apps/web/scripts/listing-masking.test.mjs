import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// listing-display.ts only has type imports, which transpiling erases.
function load(relative) {
  const exports = {};
  const {outputText} = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  });
  vm.runInNewContext(outputText, {exports, require: () => ({})});
  return exports;
}

const {isMaskedLocation, visibleCountry, LOCATION_SHARED_LATER} = load('../src/lib/listing-display.ts');

test('the API privacy placeholder is a masked location', () => {
  assert.equal(isMaskedLocation('Hidden until session'), true);
  assert.equal(isMaskedLocation('  Hidden  '), true);
});

test('country codes and empty values are not masked', () => {
  assert.equal(isMaskedLocation('GH'), false);
  assert.equal(isMaskedLocation('us'), false);
  assert.equal(isMaskedLocation(''), false);
  assert.equal(isMaskedLocation(undefined), false);
  assert.equal(isMaskedLocation(null), false);
});

test('visibleCountry hides the placeholder and keeps real codes', () => {
  assert.equal(visibleCountry('Hidden until session'), '');
  assert.equal(visibleCountry('GH'), 'GH');
  assert.equal(visibleCountry(undefined), '');
});

test('the replacement words are plain', () => {
  assert.equal(LOCATION_SHARED_LATER, 'Location shared after purchase');
});
