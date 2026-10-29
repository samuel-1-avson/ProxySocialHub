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
  vm.runInNewContext(outputText, { exports, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  } });
  return exports;
}
const measurements = load('../src/lib/measurements.ts');
const adapter = load('../src/lib/map/marketplace-map-adapters.ts', { '@/lib/measurements': measurements });
const helpers = load('../src/components/map/mapHelpers.ts', {
  '@/lib/measurements': measurements,
  '@/lib/navigation/workspace': { explorerHref: () => { throw new Error('No private node link should be created'); } },
});
const listing = { id: 'listing:offer', kind: 'listing', listing_id: 'offer', title: 'Reported offer', status: 'active', purchasable: true, lat: 5, lon: 0, geo_source: 'region_hub' };

test('a published offer never becomes evidence that its provider is connected', () => {
  const pin = adapter.marketplacePointToListingPin(listing);
  assert.equal(pin.purchasable, true);
  assert.equal(pin.status, 'active');
  assert.equal(pin.node_active, undefined);
  assert.equal(pin.uptime_percent, undefined);
  assert.equal(pin.quality_score, undefined);
});

test('a validator flag does not create a high-quality endorsement or a missing health measurement', () => {
  const node = adapter.marketplacePointToNode({ ...listing, id: 'node:public-id', kind: 'node', status: 'unknown', is_validator: true });
  assert.equal(node.status, 'unknown');
  const html = helpers.singleNodePopup(node, '#a855f7');
  assert.match(html, /Proxy node/);
  assert.match(html, /unknown/);
  assert.match(html, /Not reported/);
  assert.doesNotMatch(html, /High quality|Standard/);
});
