/**
 * Regression guard for the regional-hub coordinate snap.
 * Run: node --test scripts/geo-hub-guard.test.mjs  (npm run test:geo-hub-guard)
 *
 * A Ghana node's coordinates under a stale "US" country used to snap to the
 * nearest US hub — Boston — pinning the listing on the wrong continent.
 * The snap is distance-bound now (mirrors the Go control-api guard).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(relative, dependencies = {}) {
  const exports = {};
  const source = new URL(relative, import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  vm.runInNewContext(outputText, {
    exports,
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

const hubData = load('../src/lib/geo/regional-hubs-data.ts', {
  '@/lib/geo/regional-hubs-types': {},
});
const hubs = load('../src/lib/geo/regional-hubs.ts', {
  '@/lib/geo/regional-hubs-data': hubData,
  '@/lib/geo/regional-hubs-types': {},
});

test('Ghana coordinates claimed as US do not snap to Boston', () => {
  const got = hubs.resolveRegionalHub('US', '', '', 5.1053, -1.2466); // Cape Coast
  assert.equal(got, undefined);
});

test('in-country coordinate snaps still resolve', () => {
  assert.equal(hubs.resolveRegionalHub('US', '', '', 42.4, -71.1)?.name, 'Boston');
  assert.equal(hubs.resolveRegionalHub('GH', '', '', 6.72, -1.61)?.name, 'Kumasi');
});

test('text matches are not distance-bound', () => {
  assert.equal(hubs.resolveRegionalHub('GH', 'Kumasi', '', 0, 0)?.name, 'Kumasi');
});
